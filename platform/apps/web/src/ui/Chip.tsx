import type { ReactNode } from 'react'
import styles from './Chip.module.css'

type Tone = 'neutral' | 'sun' | 'leaf' | 'tomato'

/** Une pastille : une spécialité, un état. Le texte reste lisible sans la couleur. */
export function Chip({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`${styles.chip} ${styles[tone]}`}>{children}</span>
}
