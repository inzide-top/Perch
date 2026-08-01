import { chinaCities } from '@/data/chinaCities'

export type OpportunityRegion =
  | 'north_china'
  | 'east_china'
  | 'south_china'
  | 'central_china'
  | 'southwest_china'
  | 'northwest_china'
  | 'northeast_china'
  | 'other'

export const opportunityRegionOptions: Array<{ label: string; value: OpportunityRegion }> = [
  { label: '华北', value: 'north_china' },
  { label: '华东', value: 'east_china' },
  { label: '华南', value: 'south_china' },
  { label: '华中', value: 'central_china' },
  { label: '西南', value: 'southwest_china' },
  { label: '西北', value: 'northwest_china' },
  { label: '东北', value: 'northeast_china' },
  { label: '其他', value: 'other' },
]

const regionByProvince: Record<string, OpportunityRegion> = {
  北京: 'north_china',
  天津: 'north_china',
  河北: 'north_china',
  山西: 'north_china',
  内蒙古: 'north_china',
  上海: 'east_china',
  江苏: 'east_china',
  浙江: 'east_china',
  安徽: 'east_china',
  福建: 'east_china',
  江西: 'east_china',
  山东: 'east_china',
  广东: 'south_china',
  广西: 'south_china',
  海南: 'south_china',
  河南: 'central_china',
  湖北: 'central_china',
  湖南: 'central_china',
  重庆: 'southwest_china',
  四川: 'southwest_china',
  贵州: 'southwest_china',
  云南: 'southwest_china',
  西藏: 'southwest_china',
  陕西: 'northwest_china',
  甘肃: 'northwest_china',
  青海: 'northwest_china',
  宁夏: 'northwest_china',
  新疆: 'northwest_china',
  辽宁: 'northeast_china',
  吉林: 'northeast_china',
  黑龙江: 'northeast_china',
}

const municipalityRegionByCity: Record<string, OpportunityRegion> = {
  北京: 'north_china',
  天津: 'north_china',
  上海: 'east_china',
  重庆: 'southwest_china',
}

const regionByCity = new Map<string, OpportunityRegion>()

for (const province of chinaCities) {
  const region = regionByProvince[province.name]
  if (!region) continue

  for (const city of province.cities) regionByCity.set(city, region)
}

for (const [city, region] of Object.entries(municipalityRegionByCity)) {
  regionByCity.set(city, region)
}

export function getOpportunityRegionByCity(city: string): OpportunityRegion {
  return regionByCity.get(city.trim()) ?? 'other'
}

export function getOpportunityRegions(cities: string[] | undefined): OpportunityRegion[] {
  return [...new Set((cities ?? []).map(getOpportunityRegionByCity))]
}
