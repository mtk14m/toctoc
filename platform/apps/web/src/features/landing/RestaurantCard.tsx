import type { RestaurantCard as Restaurant, UnavailableReason } from '../../api/types'
import { formatGnf } from '../../lib/money'
import { formatClockFr } from '../../lib/time'
import { Chip } from '../../ui/Chip'
import styles from './RestaurantCard.module.css'

const UNAVAILABLE_LABELS: Record<UnavailableReason, string> = {
  SERVICE_NOT_OPEN: 'Service fermé pour le moment',
  TOO_LATE_TO_DELIVER: 'Trop tard pour aujourd’hui',
  PARTNER_CLOSED_AT_THAT_TIME: 'Ferme avant la livraison',
  NO_MENU_FOR_DATE: 'Pas de menu aujourd’hui',
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)

/** 4.5 → « 4,5 » ; 5 → « 5 ». */
const formatAverage = (average: number) => String(average).replace('.', ',')

/** Une fiche de l'annuaire : ce qu'on y mange aujourd'hui, et si on peut commander maintenant. */
export function RestaurantCard({ restaurant }: { restaurant: Restaurant }) {
  const { name, city, tags, hours, rating, todaysMenu, availability } = restaurant
  const hiddenDishes = todaysMenu.count - todaysMenu.preview.length

  return (
    <article className={styles.card} data-available={availability.available}>
      <header className={styles.header}>
        <h3 className={styles.name}>{name}</h3>
        <p className={styles.meta}>
          <span>{city}</span>
          <span aria-hidden="true">·</span>
          <span>
            {formatClockFr(hours.start)} – {formatClockFr(hours.end)}
          </span>
        </p>
      </header>

      {tags.length > 0 && (
        <ul className={styles.tags} role="list" aria-label="Spécialités">
          {tags.map((tag) => (
            <li key={tag}>
              <Chip>{tag}</Chip>
            </li>
          ))}
        </ul>
      )}

      {todaysMenu.preview.length > 0 && (
        <div className={styles.menu}>
          <ul role="list" aria-label="Menu du jour" className={styles.dishes}>
            {todaysMenu.preview.map((dish) => (
              <li key={dish.name} className={styles.dish}>
                <span>{dish.name}</span>
                <span className={styles.price}>{formatGnf(dish.price)}</span>
              </li>
            ))}
          </ul>
          {hiddenDishes > 0 && (
            <p className={styles.more}>
              + {hiddenDishes} {plural(hiddenDishes, 'autre plat', 'autres plats')}
            </p>
          )}
        </div>
      )}

      <footer className={styles.footer}>
        {rating ? (
          <p className={styles.rating}>
            <span className={styles.star} aria-hidden="true">
              ★
            </span>
            <strong>{formatAverage(rating.average)}</strong>
            <span className={styles.count}>{rating.count} avis</span>
          </p>
        ) : (
          <p className={styles.count}>Pas encore noté</p>
        )}

        {availability.available ? (
          <Chip tone="leaf">Commandable maintenant</Chip>
        ) : (
          <Chip tone="tomato">{UNAVAILABLE_LABELS[availability.reason]}</Chip>
        )}
      </footer>
    </article>
  )
}
