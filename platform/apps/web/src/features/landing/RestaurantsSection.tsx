import { Button } from '../../ui/Button'
import { RestaurantCard } from './RestaurantCard'
import styles from './RestaurantsSection.module.css'
import { useRestaurants } from './useRestaurants'

export function RestaurantsSection() {
  const { state, retry } = useRestaurants()

  return (
    <section id="restaurants" className={styles.section} aria-labelledby="restaurants-title">
      <div className="container">
        <header className={styles.header}>
          <h2 id="restaurants-title" className={styles.title}>
            Les restaurants du jour
          </h2>
          <p className={styles.lead}>
            Un restaurant par commande : vous choisissez celui qui vous fait envie, vos collègues se
            joignent à vous par le lien.
          </p>
        </header>

        {state.status === 'loading' && (
          <p role="status" className={styles.notice}>
            Chargement des restaurants…
          </p>
        )}

        {state.status === 'error' && (
          <div role="alert" className={styles.notice}>
            <p>{state.message}</p>
            <Button variant="sun" onClick={retry}>
              Réessayer
            </Button>
          </div>
        )}

        {state.status === 'success' &&
          (state.restaurants.length === 0 ? (
            <p className={styles.notice}>Aucun restaurant n’est encore ouvert. Revenez bientôt !</p>
          ) : (
            <ul role="list" className={styles.grid}>
              {state.restaurants.map((restaurant) => (
                <li key={restaurant.id}>
                  <RestaurantCard restaurant={restaurant} />
                </li>
              ))}
            </ul>
          ))}
      </div>
    </section>
  )
}
