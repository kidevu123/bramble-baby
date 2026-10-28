/** Primary sources behind every number in this folder. Referenced by id from the datasets. */
export interface Source {
  id: string
  org: string
  title: string
  url: string
  year: number
}

export const SOURCES: Source[] = [
  { id: 'aasm-2016', org: 'American Academy of Sleep Medicine', title: 'Recommended amount of sleep for pediatric populations: a consensus statement', url: 'https://jcsm.aasm.org/doi/10.5664/jcsm.5866', year: 2016 },
  { id: 'nsf-2015', org: 'National Sleep Foundation', title: "Sleep time duration recommendations", url: 'https://www.sleephealthjournal.org/article/S2352-7218(15)00015-7/fulltext', year: 2015 },
  { id: 'aap-safe-sleep-2022', org: 'American Academy of Pediatrics', title: 'Sleep-Related Infant Deaths: Updated 2022 Recommendations for Reducing Infant Deaths in the Sleep Environment', url: 'https://publications.aap.org/pediatrics/article/150/1/e2022057990/188304', year: 2022 },
  { id: 'hc-feeding-amount', org: 'AAP HealthyChildren.org', title: 'Amount and Schedule of Baby Formula Feedings', url: 'https://www.healthychildren.org/English/ages-stages/baby/formula-feeding/Pages/Amount-and-Schedule-of-Formula-Feedings.aspx', year: 2022 },
  { id: 'kent-2006', org: 'Pediatrics (Kent et al.)', title: 'Volume and frequency of breastfeedings and fat content of breast milk throughout the day', url: 'https://doi.org/10.1542/peds.2005-1417', year: 2006 },
  { id: 'hc-breastfeeding-often', org: 'AAP HealthyChildren.org', title: 'How Often and How Much Should Your Baby Eat?', url: 'https://www.healthychildren.org/English/ages-stages/baby/feeding-nutrition/Pages/How-Often-and-How-Much-Should-Your-Baby-Eat.aspx', year: 2022 },
  { id: 'cdc-breastfeeding-often', org: 'CDC', title: 'How Much and How Often to Breastfeed', url: 'https://www.cdc.gov/infant-toddler-nutrition/breastfeeding/how-much-and-how-often.html', year: 2024 },
  { id: 'cdc-solids', org: 'CDC', title: 'When, What, and How to Introduce Solid Foods', url: 'https://www.cdc.gov/infant-toddler-nutrition/foods-and-drinks/when-to-introduce-solid-foods.html', year: 2024 },
  { id: 'aap-allergy-2019', org: 'American Academy of Pediatrics', title: 'The Effects of Early Nutritional Interventions on the Development of Atopic Disease in Infants and Children', url: 'https://publications.aap.org/pediatrics/article/143/4/e20190281/37226', year: 2019 },
  { id: 'niaid-peanut-2017', org: 'NIAID', title: 'Addendum guidelines for the prevention of peanut allergy in the United States', url: 'https://www.niaid.nih.gov/diseases-conditions/guidelines-clinicians-and-patients-food-allergy', year: 2017 },
  { id: 'hc-diapers', org: 'AAP HealthyChildren.org', title: 'How Often and How Much Should Your Baby Eat? / Baby’s First Days: Bowel Movements & Urination', url: 'https://www.healthychildren.org/English/ages-stages/baby/Pages/Babys-First-Days-Bowel-Movements-and-Urination.aspx', year: 2021 },
  { id: 'who-growth-2006', org: 'World Health Organization', title: 'WHO Child Growth Standards: length/height-for-age, weight-for-age, head circumference-for-age', url: 'https://www.who.int/tools/child-growth-standards/standards', year: 2006 },
  { id: 'cdc-who-charts', org: 'CDC', title: 'Use of WHO growth charts for children under 2 in the United States', url: 'https://www.cdc.gov/growthcharts/who-growth-charts.htm', year: 2010 },
  { id: 'hc-weight-gain', org: 'AAP HealthyChildren.org', title: 'How Much Weight Should My Baby Gain?', url: 'https://www.healthychildren.org/English/ages-stages/baby/Pages/Newborn-Weight-Gain.aspx', year: 2021 },
  { id: 'hc-fever', org: 'AAP HealthyChildren.org', title: 'Fever and Your Baby / When to Call the Pediatrician: Fever', url: 'https://www.healthychildren.org/English/health-issues/conditions/fever/Pages/When-to-Call-the-Pediatrician.aspx', year: 2022 },
  { id: 'aap-tummy-time', org: 'AAP HealthyChildren.org', title: 'Back to Sleep, Tummy to Play', url: 'https://www.healthychildren.org/English/ages-stages/baby/sleep/Pages/back-to-sleep-tummy-to-play.aspx', year: 2022 },
  { id: 'aap-media-2016', org: 'American Academy of Pediatrics', title: 'Media and Young Minds (policy statement)', url: 'https://publications.aap.org/pediatrics/article/138/5/e20162591/60503', year: 2016 },
  { id: 'aap-vitamin-d', org: 'AAP HealthyChildren.org', title: 'Vitamin D: On the Double', url: 'https://www.healthychildren.org/English/healthy-living/nutrition/Pages/Vitamin-D-On-the-Double.aspx', year: 2021 },
  { id: 'aap-iron', org: 'AAP HealthyChildren.org', title: 'Iron Needs of Babies and Children', url: 'https://www.healthychildren.org/English/healthy-living/nutrition/Pages/Iron-Needs-of-Babies-and-Children.aspx', year: 2021 },
  { id: 'acog-labor', org: 'ACOG', title: 'How to Tell When Labor Begins', url: 'https://www.acog.org/womens-health/faqs/how-to-tell-when-labor-begins', year: 2020 },
  { id: 'acog-kicks', org: 'ACOG', title: 'Fetal movement counting (kick counts)', url: 'https://www.acog.org/womens-health/faqs/special-tests-for-monitoring-fetal-well-being', year: 2021 },
  { id: 'nhs-pregnancy-weeks', org: 'NHS', title: 'Pregnancy week-by-week', url: 'https://www.nhs.uk/pregnancy/week-by-week/', year: 2023 },
  { id: 'hc-wake-windows', org: 'AAP HealthyChildren.org', title: 'Healthy Sleep Habits: How Many Hours Does Your Child Need?', url: 'https://www.healthychildren.org/English/healthy-living/sleep/Pages/Healthy-Sleep-Habits-How-Many-Hours-Does-Your-Child-Need.aspx', year: 2023 },
]

export const SOURCE_BY_ID = new Map(SOURCES.map((s) => [s.id, s]))
