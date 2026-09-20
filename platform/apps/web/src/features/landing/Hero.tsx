import { Button } from '../../ui/Button'
import styles from './Hero.module.css'
import { OrderPreview } from './OrderPreview'

export function Hero() {
  return (
    <section className={styles.hero}>
      <div className={`container ${styles.inner}`}>
        <div className={styles.copy}>
          <p className={styles.kicker}>Conakry · midi et soir de bureau</p>
          <h1 className={styles.title}>
            Le déjeuner du bureau, <span className={styles.mark}>en un lien.</span>
          </h1>
          <p className={styles.lead}>
            Lancez une commande, partagez le lien à vos collègues : chacun choisit son plat, paie sa
            part, et tout arrive ensemble. Plus vous êtes nombreux, moins la livraison coûte.
          </p>
          <div className={styles.actions}>
            <Button href="#restaurants" size="lg">
              Choisir un restaurant
            </Button>
            <Button href="#comment-ca-marche" variant="paper" size="lg">
              Voir comment ça marche
            </Button>
          </div>
        </div>

        <OrderPreview />
      </div>
    </section>
  )
}
