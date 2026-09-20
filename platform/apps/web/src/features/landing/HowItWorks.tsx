import { Sticker } from '../../ui/Sticker'
import styles from './HowItWorks.module.css'

const STEPS = [
  {
    title: 'Lancez',
    text: 'Choisissez un restaurant, dites où on vous livre, donnez votre nom et votre numéro. Pas de compte à créer.',
    tone: 'sun',
    tilt: -1.5,
  },
  {
    title: 'Partagez le lien',
    text: 'Envoyez-le à vos collègues. Vous avez 20 minutes : chacun choisit son plat et paie sa part en mobile money.',
    tone: 'card',
    tilt: 1,
  },
  {
    title: 'Recevez',
    text: 'Le lien se ferme, le restaurant prépare tout d’un coup et le livreur apporte l’ensemble, environ 45 minutes plus tard.',
    tone: 'leaf',
    tilt: -0.8,
  },
] as const

export function HowItWorks() {
  return (
    <section
      id="comment-ca-marche"
      className={styles.section}
      aria-labelledby="comment-ca-marche-title"
    >
      <div className="container">
        <h2 id="comment-ca-marche-title" className={styles.title}>
          Comment ça marche
        </h2>
        <ol role="list" className={styles.steps}>
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <Sticker tone={step.tone} tilt={step.tilt} className={styles.step}>
                <span className={styles.number} aria-hidden="true">
                  {index + 1}
                </span>
                <h3 className={styles.stepTitle}>{step.title}</h3>
                <p>{step.text}</p>
              </Sticker>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
