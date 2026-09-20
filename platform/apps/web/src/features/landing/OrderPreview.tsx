import { formatGnf } from '../../lib/money'
import { Chip } from '../../ui/Chip'
import { Sticker } from '../../ui/Sticker'
import styles from './OrderPreview.module.css'

const PEOPLE = [
  { name: 'Aïcha', dish: 'Riz gras', color: 'var(--tomato)' },
  { name: 'Mamadou', dish: 'Poulet braisé', color: 'var(--leaf)' },
  { name: 'Fatou', dish: 'Sauce feuille', color: 'var(--sun)', fresh: true },
] as const

/**
 * Une maquette vivante de ce que voient les collègues : la liste qui se remplit, le temps qui
 * court, le prix de livraison qui baisse. Illustrative : les noms et les plats sont inventés.
 */
export function OrderPreview() {
  return (
    <div className={styles.wrap} aria-hidden="true">
      <Sticker tilt={2.5} className={styles.card}>
        <header className={styles.header}>
          <p className={styles.restaurant}>Commande chez Mariama</p>
          <Chip tone="sun">
            <span className={styles.live} />
            encore 14 min
          </Chip>
        </header>

        <ul className={styles.people}>
          {PEOPLE.map((person) => (
            <li
              key={person.name}
              className={`${styles.person} ${'fresh' in person ? styles.fresh : ''}`}
            >
              <span className={styles.avatar} style={{ background: person.color }}>
                {person.name[0]}
              </span>
              <span className={styles.who}>
                <strong>{person.name}</strong>
                <span>{person.dish}</span>
              </span>
              <span className={styles.paid}>payé ✓</span>
            </li>
          ))}
        </ul>

        <footer className={styles.footer}>
          <span>Livraison pour le prochain</span>
          <strong>{formatGnf(5000)}</strong>
        </footer>
      </Sticker>

      <span className={styles.badge}>−1 000 GNF</span>
      <span className={styles.burst} />
    </div>
  )
}
