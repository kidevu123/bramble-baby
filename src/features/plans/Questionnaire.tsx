import { useState, type FormEvent } from 'react'
import { Button } from '../../components/ui/Button'
import { TextField } from '../../components/ui/Field'
import type { Answers, Question } from '../../lib/sleepplan'
import './plans.css'

export function Questionnaire({ questions, initial, onSubmit, onCancel }: { questions: Question[]; initial: Answers; onSubmit: (a: Answers) => void; onCancel?: () => void }) {
  const [answers, setAnswers] = useState<Answers>(initial)
  const set = (id: string, v: Answers[string]) => setAnswers((a) => ({ ...a, [id]: v }))
  const answered = questions.filter((q) => q.type === 'multi' ? true : answers[q.id] !== undefined && answers[q.id] !== '').length
  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSubmit(answers)
  }
  return (
    <form className="stack" onSubmit={submit}>
      <p className="small muted">
        {answered}/{questions.length} answered
      </p>
      {questions.map((q, idx) => (
        <section key={q.id} className="card card-pad stack q-card">
          <h3 className="q-title">
            {idx + 1}. {q.text}
          </h3>
          {q.help ? <p className="xs muted">{q.help}</p> : null}
          {q.type === 'single' && q.options ? (
            <div className="q-options" role="radiogroup">
              {q.options.map((o) => (
                <button key={o.value} type="button" role="radio" aria-checked={answers[q.id] === o.value} className={answers[q.id] === o.value ? 'q-opt active' : 'q-opt'} onClick={() => set(q.id, o.value)}>
                  {o.label}
                </button>
              ))}
            </div>
          ) : null}
          {q.type === 'multi' && q.options ? (
            <div className="q-options">
              {q.options.map((o) => {
                const arr = (answers[q.id] as string[] | undefined) ?? []
                const on = arr.includes(o.value)
                return (
                  <button key={o.value} type="button" aria-pressed={on} className={on ? 'q-opt active' : 'q-opt'} onClick={() => set(q.id, on ? arr.filter((x) => x !== o.value) : [...arr, o.value])}>
                    {o.label}
                  </button>
                )
              })}
            </div>
          ) : null}
          {q.type === 'time' ? <TextField label={q.text} hideLabel type="time" value={(answers[q.id] as string) ?? ''} onChange={(e) => set(q.id, e.target.value)} /> : null}
          {q.type === 'number' ? <TextField label={q.text} hideLabel type="number" min={q.min} max={q.max} value={answers[q.id] === undefined ? '' : String(answers[q.id])} onChange={(e) => set(q.id, Number(e.target.value))} /> : null}
        </section>
      ))}
      <div className="row">
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel} type="button">
            Cancel
          </Button>
        ) : null}
        <Button type="submit" size="lg" block>
          Build my plan
        </Button>
      </div>
    </form>
  )
}
