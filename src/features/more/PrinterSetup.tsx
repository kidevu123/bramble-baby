import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { PillChoice, TextField } from '../../components/ui/Field'
import { mk } from '../../hooks/useMilk'
import { usePrefs } from '../../hooks/usePrefs'
import { describeApiError } from '../../lib/api/client'
import { companion } from '../../lib/api/companion'
import { blobToBase64 } from '../../lib/auto-print'
import { canvasToPng, drawTestLabel } from '../../lib/labels'
import { buildPrinterSpec, parsePrinterSpec, PRINTER_KIND_LABEL, printerFormProblem, type PrinterForm, type PrinterKind } from '../../lib/printer-spec'

export const configKey = ['server-config'] as const
export const useServerConfig = () => useQuery({ queryKey: configKey, queryFn: () => companion.config.get(), staleTime: 60_000 })

/**
 * The household's own printer, set here instead of on the server: a Zebra or Brother QL on the network, or the
 * print bridge for a Bluetooth Niimbot. Only an admin of this Bramble (Baby Buddy staff) changes it; everyone
 * sees what is set. Saving it can be followed by a test label at the size picked below.
 */
export function PrinterSetup() {
  const qc = useQueryClient()
  const { prefs } = usePrefs()
  const config = useServerConfig()
  const [form, setForm] = useState<PrinterForm | null>(null)
  const save = useMutation({
    mutationFn: (spec: string | null) => companion.config.update({ printer: spec }),
    onSuccess: (next) => {
      qc.setQueryData(configKey, next)
      void qc.invalidateQueries({ queryKey: mk.printer })
      setForm(null)
    },
  })
  const test = useMutation({
    mutationFn: async () => {
      const canvas = document.createElement('canvas')
      if (!drawTestLabel(canvas, prefs.labels)) throw new Error('This phone cannot draw the label image.')
      return companion.print.label(await blobToBase64(await canvasToPng(canvas)), 'TEST')
    },
  })
  const data = config.data
  if (!data) return null
  const set = (patch: Partial<PrinterForm>) => setForm((f) => (f ? { ...f, ...patch } : f))
  const problem = form ? printerFormProblem(form) : null
  const source = data.printer.source === 'settings' ? 'Set here' : data.printer.source === 'server' ? 'Set on the server (BRAMBLE_PRINTER)' : 'No printer set'

  if (!form) {
    return (
      <div className="ls-printer-setup stack" data-testid="printer-setup">
        <span className="small muted">
          {source}
          {data.printer.spec ? ` · ${data.printer.spec}` : ''}
        </span>
        {data.admin ? (
          <span className="row ls-printer-actions">
            <Button variant="secondary" onClick={() => { save.reset(); setForm(parsePrinterSpec(data.printer.spec)) }}>
              {data.printer.spec ? 'Change printer' : 'Set up a printer'}
            </Button>
            {data.printer.spec ? (
              <Button variant="ghost" onClick={() => test.mutate()} loading={test.isPending}>
                Print a test label
              </Button>
            ) : null}
          </span>
        ) : (
          <span className="xs muted">An admin of this Bramble sets the printer here.</span>
        )}
        {test.isSuccess ? <span className="small ls-spots-done">Test label sent: it should show a frame at the sticker's edge.</span> : null}
        {test.isError ? (
          <p className="log-error" role="alert">
            {describeApiError(test.error)}
          </p>
        ) : null}
      </div>
    )
  }
  return (
    <form
      className="ls-printer-setup stack"
      data-testid="printer-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (!problem) save.mutate(buildPrinterSpec(form))
      }}
    >
      <PillChoice
        label="Printer kind"
        tone="teal"
        value={form.kind}
        onChange={(kind: PrinterKind) => set({ kind, port: kind === 'bridge' ? '8110' : kind === 'zebra' ? '9100' : form.port })}
        options={(Object.keys(PRINTER_KIND_LABEL) as PrinterKind[]).map((k) => ({ value: k, label: PRINTER_KIND_LABEL[k] }))}
      />
      {form.kind === 'zebra' || form.kind === 'brother_ql' || form.kind === 'bridge' ? (
        <TextField label={form.kind === 'bridge' ? 'Print bridge address' : "Printer's IP address"} value={form.host} onChange={(e) => set({ host: e.target.value })} placeholder="192.0.2.2" inputMode="url" autoCapitalize="none" />
      ) : null}
      {form.kind === 'zebra' || form.kind === 'bridge' ? <TextField label="Port" value={form.port} onChange={(e) => set({ port: e.target.value })} inputMode="numeric" /> : null}
      {form.kind === 'brother_ql' ? (
        <>
          <TextField label="Model" value={form.model} onChange={(e) => set({ model: e.target.value })} placeholder="QL-810W" autoCapitalize="characters" />
          <TextField label="Label (brother_ql name)" value={form.label} onChange={(e) => set({ label: e.target.value })} placeholder="29x62" autoCapitalize="none" />
        </>
      ) : null}
      {form.kind === 'bridge' ? <TextField label="Bridge token" value={form.token} onChange={(e) => set({ token: e.target.value })} autoCapitalize="none" hint="From the bridge's env file on the computer it runs on. Shown as •••• once saved." /> : null}
      {form.kind === 'other' ? <TextField label="Printer address" value={form.raw} onChange={(e) => set({ raw: e.target.value })} placeholder="zebra://192.0.2.2:9100?darkness=22" autoCapitalize="none" /> : null}
      <p className="xs muted">
        {form.kind === 'zebra'
          ? 'A Zebra (GK420d and similar) on the network: raw printing on port 9100. The label size below is exactly what prints.'
          : form.kind === 'brother_ql'
            ? 'A Brother QL on the network (QL-810W, QL-820NWB…), printed with brother_ql.'
            : form.kind === 'bridge'
              ? 'A Bluetooth or USB label printer (Niimbot) next to another computer that runs the Bramble print bridge.'
              : form.kind === 'none'
                ? 'Labels go out through the share sheet (the printer app), AirPrint or Photos.'
                : 'Any address the Bramble server understands.'}
      </p>
      {problem && form.kind !== 'none' ? <p className="small text-health">{problem}</p> : null}
      {save.isError ? (
        <p className="log-error" role="alert">
          {describeApiError(save.error)}
        </p>
      ) : null}
      <span className="row ls-printer-actions">
        <Button variant="secondary" type="button" onClick={() => setForm(null)} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending} disabled={problem !== null}>
          Save printer
        </Button>
      </span>
    </form>
  )
}
