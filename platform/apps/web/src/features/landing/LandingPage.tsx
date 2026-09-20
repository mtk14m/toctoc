import { FeeSection } from './FeeSection'
import { Hero } from './Hero'
import { HowItWorks } from './HowItWorks'
import { RestaurantsSection } from './RestaurantsSection'
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'

export function LandingPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <HowItWorks />
        <FeeSection />
        <RestaurantsSection />
      </main>
      <SiteFooter />
    </>
  )
}
