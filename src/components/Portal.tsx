import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  children: React.ReactNode
}

export default function Portal({ children }: Props) {
  const el = useRef<HTMLDivElement | null>(null)
  if (el.current === null) {
    const node = document.createElement('div')
    node.className = 'portal-mount'
    el.current = node
  }

  useEffect(() => {
    const container = el.current!
    document.body.appendChild(container)
    return () => { document.body.removeChild(container) }
  }, [])

  return createPortal(children, el.current!)
}
