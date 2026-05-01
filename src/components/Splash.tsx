import { useState, useEffect, useRef } from 'react'
import './Splash.css'

interface Props {
  loaded: boolean
}

export default function Splash({ loaded }: Props) {
  const [exited, setExited] = useState(false)
  const elRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!loaded) return
    const el = elRef.current
    if (!el) { setExited(true); return }
    const handler = () => setExited(true)
    el.addEventListener('transitionend', handler, { once: true })
    return () => el.removeEventListener('transitionend', handler)
  }, [loaded])

  if (exited) return null

  return (
    <div
      ref={elRef}
      className={`splash ${loaded ? 'splash--out' : ''}`}
    >
      <img src="/abscissa-logo.png" alt="Abscissa" className="splash-logo" />
      <div className="splash-rule" />
    </div>
  )
}
