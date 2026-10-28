import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { configKey, useServerConfig } from '../features/more/PrinterSetup'
import { companion } from '../lib/api/companion'
import { phoneZone, zoneToSeed } from '../lib/time-zone'

/**
 * Records the household's time zone from an admin's phone the first time one opens the app, so the companion
 * writes notification clocks in the family's zone rather than its container's (`zoneToSeed`). Once set, only
 * Settings › Notifications › Time zone changes it.
 */
export function TimeZoneSync() {
  const qc = useQueryClient()
  const config = useServerConfig()
  const tried = useRef(false)
  const save = useMutation({
    mutationFn: (zone: string) => companion.config.update({ timeZone: zone }),
    onSuccess: (next) => qc.setQueryData(configKey, next),
  })
  const zone = zoneToSeed(config.data, phoneZone())
  useEffect(() => {
    if (!zone || tried.current) return
    tried.current = true // once per launch: a refusal (an older companion) is not retried in a loop
    save.mutate(zone)
  }, [zone]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}
