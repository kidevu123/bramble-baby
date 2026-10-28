import { useMutation, useQueryClient } from '@tanstack/react-query'
import { describeApiError } from '../../lib/api/client'
import { companion } from '../../lib/api/companion'
import { phoneZone, zoneLabel } from '../../lib/time-zone'
import { configKey, useServerConfig } from '../more/PrinterSetup'

/**
 * Which zone the times in notifications are written in ("Last session 2:30 PM"), with a way for an admin to
 * move it to this phone's zone after a move or when the household was set up from a phone abroad.
 */
export function TimeZoneLine() {
  const qc = useQueryClient()
  const config = useServerConfig()
  const save = useMutation({
    mutationFn: (zone: string) => companion.config.update({ timeZone: zone }),
    onSuccess: (next) => qc.setQueryData(configKey, next),
  })
  const tz = config.data?.timeZone
  if (!config.data || !tz) return null
  const phone = phoneZone()
  const differs = phone !== null && phone !== tz.value
  return (
    <div className="small muted time-zone-line" data-testid="time-zone">
      <p>
        Times in notifications: {zoneLabel(tz.value)}
        {tz.source === 'server' ? ' (the server’s zone)' : ''}
      </p>
      {differs ? (
        <p>
          This phone is in {zoneLabel(phone)}.{' '}
          {config.data.admin ? (
            <button type="button" className="link-btn" disabled={save.isPending} onClick={() => save.mutate(phone)}>
              Use this phone’s
            </button>
          ) : (
            'An admin can change it here.'
          )}
        </p>
      ) : null}
      {save.isError ? (
        <p className="log-error" role="alert">
          {describeApiError(save.error)}
        </p>
      ) : null}
    </div>
  )
}
