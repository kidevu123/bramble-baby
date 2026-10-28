import { PrinterIcon } from '../../components/icons'
import { Sheet } from '../../components/ui/Sheet'
import { Toggle } from '../../components/ui/Toggle'
import { useChildren } from '../../hooks/useChildren'
import { useChildSettings } from '../../hooks/useChildSettings'
import { usePrinterStatus } from '../../hooks/useMilk'
import { usePrefs } from '../../hooks/usePrefs'
import { LabelSettings } from '../log/LabelSettings'
import { SpotStickers } from './SpotStickers'
import { TravelStickers } from './TravelStickers'
import { PrinterSetup } from './PrinterSetup'
import './label-settings.css'

/**
 * Settings › Milk labels & printer. The one place label size, fields and printer live: Settings opens it
 * from its row, and the milk label sheet opens the same sheet nested in place, so closing it returns to the label.
 *
 * The printer comes first (is there one, does Save print), then the stock and what goes on it; the reasons
 * behind each setting wait under "About labels and printing" at the bottom.
 */
export function LabelSettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { prefs, update } = usePrefs()
  const { child } = useChildren()
  const { update: updateShared } = useChildSettings(child?.id ?? null)
  const printer = usePrinterStatus()
  const setAutoPrint = (autoPrint: boolean) => update({ labels: { ...prefs.labels, autoPrint } })
  const configured = Boolean(printer.data?.configured)
  return (
    <Sheet open={open} title="Milk labels & printer" onClose={onClose}>
      <div className="stack ls-sheet">
        <section className="card ls-printer" aria-label="Printer">
          <div className="ls-printer-head">
            <span className="ls-printer-icon" aria-hidden>
              <PrinterIcon />
            </span>
            <span className="ls-row-text grow">
              {configured ? (
                <>
                  <span className="strong">Server printer connected</span>
                  <span className="small muted ls-target">{printer.data?.target ?? printer.data?.kind}</span>
                </>
              ) : (
                <>
                  <span className="strong">{printer.isLoading ? 'Checking the printer…' : 'No printer on the Bramble server'}</span>
                  <span className="small muted">Labels go out through the share sheet (printer app), AirPrint or Photos.</span>
                </>
              )}
            </span>
          </div>
          <PrinterSetup />
          {configured ? (
            <div className="ls-row ls-auto">
              <span className="grow ls-row-text">
                Print when a pumping is saved
                <span className="small muted">Type the volume, tap Save: the sticker prints. Reprint from the label or the Stash.</span>
              </span>
              <Toggle label="Print when a pumping is saved" checked={prefs.labels.autoPrint} onChange={setAutoPrint} />
            </div>
          ) : null}
        </section>

        <LabelSettings childName={child?.first_name} unit={prefs.units.volume} onWindows={(milkWindows) => updateShared({ milkWindows })} />

        <section className="stack ls-stickers" aria-label="Stickers to print">
          <h3 className="field-group-title">Stickers to print</h3>
          <SpotStickers printer={configured} />
          <TravelStickers printer={configured} child={child ?? null} />
        </section>

        <details className="ls-about">
          <summary>About labels and printing</summary>
          <div className="ls-about-body small muted">
            <p>Every label registers a bag in the Stash and carries its QR code. Print from the pumping sheet, the pumping timer, or Stash › Add milk you already have.</p>
            <p>
              iPhone web apps cannot use Bluetooth or USB, so the Bramble server does the printing. A Niimbot B1/B21 paired to the server's Bluetooth (or on a USB cable to it) prints from the Print button with no phone app, anywhere within Bluetooth range of the server. A Zebra or Brother QL on the network works the same from anywhere in the house; the size picked above is exactly what it prints, so change it here when you load different stock. Without a server printer, the label goes through the share sheet into the printer's own app, AirPrint, or Photos. Pick the matching label size above.
            </p>
            <p>Sun or moon: night milk carries melatonin and almost none by day; morning milk has the most cortisol. That much is measured. Whether a premade bottle of night milk helps a baby sleep has not been shown, so the mark only says when the milk was pumped.</p>
            <p>Storage windows: CDC guidance for freshly expressed milk is 4 hours at room temperature, 4 days refrigerated, 6 months frozen (up to 12). Change them if your pediatrician or NICU says otherwise; they set every bag's use-by dates and reminders.</p>
          </div>
        </details>
      </div>
    </Sheet>
  )
}
