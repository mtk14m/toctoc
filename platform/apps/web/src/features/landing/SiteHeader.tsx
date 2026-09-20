import { Button } from '../../ui/Button'
import { Logo } from '../../ui/Logo'
import styles from './SiteHeader.module.css'

export function SiteHeader() {
  return (
    <header className={styles.header}>
      <div className={`container ${styles.inner}`}>
        <a href="#" className={styles.home} aria-label="TocToc, accueil">
          <Logo />
        </a>
        <nav aria-label="Principale" className={styles.nav}>
          <a href="#comment-ca-marche">Comment ça marche</a>
          <a href="#restaurants">Restaurants</a>
        </nav>
        <Button href="#restaurants" variant="sun">
          Lancer une commande
        </Button>
      </div>
    </header>
  )
}
