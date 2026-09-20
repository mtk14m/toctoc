import { Logo } from '../../ui/Logo'
import styles from './SiteFooter.module.css'

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.inner}`}>
        <Logo />
        <p>Livraison de repas de bureau à Conakry, de 9h à minuit.</p>
      </div>
    </footer>
  )
}
