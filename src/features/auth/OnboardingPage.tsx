import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Logo } from '../../components/icons'
import { Button } from '../../components/ui/Button'
import { TextField } from '../../components/ui/Field'
import { children as childrenApi } from '../../lib/api/endpoints'
import { qk } from '../../lib/api/keys'
import { describeApiError } from '../../lib/api/client'
import { usePrefs } from '../../hooks/usePrefs'
import './auth.css'

/** One screen, three fields. No 18-step questionnaire. */
export function OnboardingPage() {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { update } = usePrefs()

  const create = useMutation({
    mutationFn: () => childrenApi.create({ first_name: firstName.trim(), last_name: lastName.trim(), birth_date: birthDate }),
    onSuccess: async (child) => {
      update({ selectedChild: child.id })
      await qc.invalidateQueries({ queryKey: qk.children })
      navigate('/', { replace: true })
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    create.mutate()
  }

  return (
    <main className="auth-page">
      <div className="auth-hero">
        <Logo className="auth-logo" />
        <h1>Who are we tracking?</h1>
        <p className="muted">Add your little one. Expecting? Enter the due date and Bramble starts in pregnancy mode with a contraction timer.</p>
      </div>
      <form className="auth-card card" onSubmit={onSubmit}>
        <TextField label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required autoFocus placeholder="Baby's name, or a nickname for now" />
        <TextField label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} hint="Optional" />
        <TextField label="Birth date or due date" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} required />
        {create.isError ? (
          <p className="auth-error" role="alert">
            {describeApiError(create.error)}
          </p>
        ) : null}
        <Button type="submit" size="lg" block loading={create.isPending}>
          Start tracking
        </Button>
      </form>
    </main>
  )
}
