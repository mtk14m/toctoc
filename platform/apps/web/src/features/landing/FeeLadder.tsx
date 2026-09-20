import type { CSSProperties } from 'react'
import { formatGnf } from '../../lib/money'
import { DELIVERY_FEE_LADDER } from './delivery-fees'
import styles from './FeeLadder.module.css'

/** Des marches qui descendent : plus le groupe grandit, moins la livraison coûte. */
export function FeeLadder() {
  return (
    <ol role="list" aria-label="Frais de livraison par palier" className={styles.ladder}>
      {DELIVERY_FEE_LADDER.map((step, index) => (
        <li
          key={step.label}
          className={styles.step}
          // La marche baisse avec le prix : la forme raconte la même chose que le chiffre.
          style={{ '--drop': `${index * 1.1}rem` } as CSSProperties}
          data-floor={index === DELIVERY_FEE_LADDER.length - 1}
        >
          <span className={styles.who}>{step.label}</span>
          <span className={styles.fee}>{formatGnf(step.fee)}</span>
        </li>
      ))}
    </ol>
  )
}
