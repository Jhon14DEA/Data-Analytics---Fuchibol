export type Provider = 'API-Football' | 'AllSportsApi' | 'FOOTBALL_DATA';
export type CompetitionMetadata = { id: string; name: string; country: string | null; gender?: string | null; ageCategory?: string | null; reserve?: boolean | null };
export type CompetitionClass = 'MEN_SENIOR' | 'WOMEN' | 'YOUTH' | 'RESERVE' | 'UNKNOWN';
export type ScopeBinding = { key: string; country: string; name: string; provider: Provider; id: string | null; evidence: string };
// IDs verified against the existing API-Football directory cache, not guessed from names.
export const HISTORICAL_SCOPE: readonly ScopeBinding[] = [
  ['premier-league','England','Premier League','39'], ['la-liga','Spain','La Liga','140'],
  ['serie-a','Italy','Serie A','135'], ['bundesliga','Germany','Bundesliga','78'], ['ligue-1','France','Ligue 1','61'],
  ['champions-league','World','UEFA Champions League',null], ['europa-league','World','UEFA Europa League',null],
  ['brazil-serie-a','Brazil','Serie A','71'], ['argentina-primera','Argentina','Liga Profesional Argentina','128'],
  ['ecuador-ligapro','Ecuador','Liga Pro','242'], ['colombia-primera-a','Colombia','Primera A','239'], ['liga-mx','Mexico','Liga MX','262']
].map(([key,country,name,id]) => ({key:key!,country:country!,name:name!,id,provider:'API-Football' as Provider,evidence:id ? 'LOCAL_API_DIRECTORY_2026_10_13_EXACT_ID_COUNTRY_NAME' : 'PENDING_PROVIDER_ID_VERIFICATION'})).concat([{key:'premier-league',country:'England',name:'Premier League',id:'E0',provider:'FOOTBALL_DATA',evidence:'FOOTBALL_DATA_ACCESS_CHECK_3_VERIFIED_MATCHES'},
  {key:'la-liga',country:'Spain',name:'Primera Division',id:'SP1',provider:'FOOTBALL_DATA',evidence:'EXPLICIT_FOOTBALL_DATA_COMPETITION_CONFIG'},
  {key:'serie-a',country:'Italy',name:'Serie A',id:'I1',provider:'FOOTBALL_DATA',evidence:'EXPLICIT_FOOTBALL_DATA_COMPETITION_CONFIG'},
  {key:'bundesliga',country:'Germany',name:'Bundesliga',id:'D1',provider:'FOOTBALL_DATA',evidence:'EXPLICIT_FOOTBALL_DATA_COMPETITION_CONFIG'},
  {key:'ligue-1',country:'France',name:'Ligue 1',id:'F1',provider:'FOOTBALL_DATA',evidence:'EXPLICIT_FOOTBALL_DATA_COMPETITION_CONFIG'}]);

export const exact = (text: string) => text.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
export function scopeBinding(provider: Provider, c: CompetitionMetadata, bindings = HISTORICAL_SCOPE) {
  const hits = bindings.filter(b => b.provider === provider && b.id !== null && b.id === c.id
    && exact(b.country) === exact(c.country ?? '') && exact(b.name) === exact(c.name));
  return hits.length === 1 ? hits[0] : null;
}
export function classifyCompetition(c: CompetitionMetadata, binding: ScopeBinding | null = null): {classification: CompetitionClass; source: string} {
  const gender=exact(c.gender ?? ''), age=exact(c.ageCategory ?? ''), name=exact(c.name);
  if (['female','women','f'].includes(gender)) return {classification:'WOMEN',source:'PROVIDER_METADATA'};
  if (c.reserve === true) return {classification:'RESERVE',source:'PROVIDER_METADATA'};
  if (['youth','junior'].includes(age) || /^u\s*\d{1,2}$/.test(age)) return {classification:'YOUTH',source:'PROVIDER_METADATA'};
  // A conflicting name prevents a positive fallback; absent male/youth markers never imply senior.
  if (/\b(women|femenin[oa]|feminina|ladies)\b/.test(name)) return {classification:'WOMEN',source:'NAME_EXCLUSION'};
  if (/\b(u\s?\d{1,2}|under.?\d{1,2}|youth|junior|juvenil)\b/.test(name)) return {classification:'YOUTH',source:'NAME_EXCLUSION'};
  if (/\b(reserve|reserves|reserva|reservas|development)\b/.test(name)) return {classification:'RESERVE',source:'NAME_EXCLUSION'};
  if (gender && !['male','men','m'].includes(gender) || age && !['senior','adult','open'].includes(age)) return {classification:'UNKNOWN',source:'UNRECOGNIZED_PROVIDER_METADATA'};
  if (['male','men','m'].includes(gender) && ['senior','adult'].includes(age) && c.reserve === false) return {classification:'MEN_SENIOR',source:'PROVIDER_METADATA'};
  if (binding && binding.id === c.id && exact(binding.name) === name && exact(binding.country) === exact(c.country ?? '')) return {classification:'MEN_SENIOR',source:'CURATED_ID_COUNTRY_NAME_FALLBACK'};
  return {classification:'UNKNOWN',source:'INSUFFICIENT_EVIDENCE'};
}
