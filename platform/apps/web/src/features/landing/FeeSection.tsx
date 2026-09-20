import { FeeLadder } from './FeeLadder'
import styles from './FeeSection.module.css'

export function FeeSection() {
  return (
    <section className={styles.section} aria-labelledby="frais-title">
      <div className={`container ${styles.inner}`}>
        <div className={styles.copy}>
          <h2 id="frais-title" className={styles.title}>
            Plus vous êtes nombreux, moins la livraison coûte
          </h2>
          <p className={styles.lead}>
            Le tarif de livraison baisse à chaque palier, et il est affiché avant que vous
            choisissiez : vous savez toujours ce que coûterait la prochaine part.
          </p>
        </div>
        <FeeLadder />
      </div>
    </section>
  )
}
