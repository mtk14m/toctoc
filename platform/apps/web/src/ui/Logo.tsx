import styles from './Logo.module.css'

/** Le mot « toctoc » avec les deux petits traits d'un coup à la porte. */
export function Logo() {
  return (
    <span className={styles.logo}>
      <svg className={styles.knock} viewBox="0 0 32 32" aria-hidden="true">
        <path d="M6 9 L2 5" />
        <path d="M6 16 H0.5" />
        <path d="M6 23 L2 27" />
        <rect x="11" y="4" width="18" height="24" rx="5" />
        <circle cx="24" cy="16" r="1.8" />
      </svg>
      <span className={styles.word}>
        toc<span>toc</span>
      </span>
    </span>
  )
}
