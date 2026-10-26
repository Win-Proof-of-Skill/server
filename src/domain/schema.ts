import Ajv from 'ajv'
import { contractsAddress, profilesAddress, endorsementsAddress, skillsAddress } from '../config'

const text = { type: 'string', maxLength: 4000 }
const short = { type: 'string', maxLength: 250 }
const id = { type: 'string', pattern: '^[0-9a-f]{64}$' }
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
const cvDate = { type: 'string', pattern: '^\\d{4}(-\\d{2}(-\\d{2})?)?$' }
const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
const strings = { type: 'array', items: short, maxItems: 100 }
const ids = { type: 'array', items: id, maxItems: 50, uniqueItems: true }
const enumeration = (...values: string[]) => ({ enum: values })
const object = (properties: object, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })
const list = (properties: object, required: string[] = []) => ({ type: 'array', maxItems: 100, items: object(properties, required) })
const links = list({ label: short, url: text }, ['label', 'url'])
const range = { startDate: cvDate, endDate: cvDate, current: { type: 'boolean' } }
const workMode = enumeration('onsite', 'remote', 'hybrid')
const contact = object({
  email: short,
  phone: short,
  website: text,
  location: object({ city: short, region: short, countryCode: { type: 'string', pattern: '^[A-Z]{2}$' } }),
  links,
})
const person = object({
  firstName: short,
  lastName: short,
  headline: short,
  skills: list(
    {
      skillId: id,
      yearsOfExperience: { type: 'number', minimum: 0, maximum: 100 },
      selfAssessedLevel: enumeration('beginner', 'intermediate', 'advanced', 'expert'),
      evidenceIds: ids,
    },
    ['skillId'],
  ),
  experience: list(
    {
      ...range,
      id: short,
      jobTitle: short,
      organization: short,
      organizationUrl: text,
      employmentType: enumeration('full_time', 'part_time', 'contract', 'freelance', 'internship', 'apprenticeship', 'self_employed'),
      location: short,
      workMode,
      description: text,
      responsibilities: strings,
      achievements: strings,
      skillIds: ids,
      contractIds: ids,
      links,
    },
    ['id', 'startDate', 'jobTitle', 'organization'],
  ),
  education: list(
    {
      ...range,
      id: short,
      institution: short,
      institutionUrl: text,
      qualification: short,
      fieldOfStudy: short,
      location: short,
      grade: short,
      coursework: strings,
      thesisTitle: short,
      honors: strings,
      description: text,
      links,
    },
    ['id', 'startDate', 'institution', 'qualification'],
  ),
  certifications: list(
    {
      id: short,
      name: short,
      issuer: short,
      issuedOn: cvDate,
      expiresOn: cvDate,
      doesNotExpire: { type: 'boolean' },
      credentialId: short,
      credentialUrl: text,
      skillIds: ids,
    },
    ['id', 'name', 'issuer'],
  ),
  projects: list(
    { ...range, id: short, title: short, role: short, organization: short, description: text, achievements: strings, skillIds: ids, contractIds: ids, links },
    ['id', 'startDate', 'title'],
  ),
  languages: list(
    {
      languageCode: short,
      proficiency: enumeration('elementary', 'limited_working', 'professional_working', 'full_professional', 'native_or_bilingual'),
      cefrLevel: enumeration('A1', 'A2', 'B1', 'B2', 'C1', 'C2'),
      certificationId: short,
    },
    ['languageCode', 'proficiency'],
  ),
  awards: list({ id: short, title: short, issuer: short, awardedOn: cvDate, description: text, url: text }, ['id', 'title']),
  publications: list({ id: short, title: short, publisher: short, publishedOn: cvDate, authors: strings, description: text, doi: short, url: text }, [
    'id',
    'title',
  ]),
  patents: list(
    {
      id: short,
      title: short,
      patentNumber: short,
      patentOffice: short,
      status: enumeration('pending', 'granted', 'expired'),
      filedOn: cvDate,
      grantedOn: cvDate,
      inventors: strings,
      description: text,
      url: text,
    },
    ['id', 'title'],
  ),
  courses: list(
    { id: short, title: short, provider: short, completedOn: cvDate, durationHours: { type: 'number', minimum: 0 }, certificateUrl: text, skillIds: ids },
    ['id', 'title'],
  ),
  volunteering: list({ ...range, id: short, organization: short, role: short, cause: short, description: text, achievements: strings, links }, [
    'id',
    'startDate',
    'organization',
    'role',
  ]),
  memberships: list({ ...range, id: short, organization: short, role: short, description: text, url: text }, ['id', 'startDate', 'organization']),
  speaking: list({ id: short, title: short, event: short, date: cvDate, location: short, description: text, links }, ['id', 'title']),
  interests: strings,
  referencesAvailableOnRequest: { type: 'boolean' },
  preferences: object({
    openToWork: { type: 'boolean' },
    desiredRoles: strings,
    employmentTypes: strings,
    workModes: { type: 'array', items: workMode },
    preferredLocations: strings,
    willingToRelocate: { type: 'boolean' },
    availableFrom: cvDate,
    noticePeriodDays: integer,
  }),
})
const entity = {
  legalName: { ...short, minLength: 1 },
  registrationNumber: short,
  countryCode: { type: 'string', pattern: '^[A-Z]{2}$' },
  foundedOn: cvDate,
  website: text,
}
const detailSchemas = {
  person,
  organization: object({ ...entity, organizationKind: short, mission: text }, ['legalName']),
  company: object({ ...entity, industry: short, legalForm: short, services: strings }, ['legalName']),
  government: object({ ...entity, jurisdiction: short, level: enumeration('national', 'regional', 'local'), department: short }, ['legalName', 'jurisdiction']),
  university: object({ ...entity, accreditations: strings, faculties: strings, programs: strings }, ['legalName']),
  school: object({ ...entity, educationLevels: strings, accreditations: strings, curriculum: text }, ['legalName']),
}
export const profileContentSchema = {
  oneOf: Object.entries(detailSchemas).map(([type, details]) =>
    object({ type: { const: type }, displayName: { ...short, minLength: 1 }, summary: text, avatarUrl: text, coverImageUrl: text, contact, details }, [
      'type',
      'displayName',
      'details',
    ]),
  ),
}
export const contractContentSchema = object(
  {
    origin: enumeration('new', 'historical'),
    title: { ...short, minLength: 1 },
    publicDescription: text,
    encryptedDescription: text,
    workerProfileId: id,
    hiringProfileIds: { ...ids, minItems: 1, maxItems: 250 },
    skillIds: ids,
    terms: object(
      {
        responsibilities: strings,
        acceptanceCriteria: strings,
        startDate: date,
        endDate: date,
        durationMonths: { type: 'integer', minimum: 1, maximum: 1200 },
        workMode,
        location: short,
      },
      ['responsibilities', 'acceptanceCriteria', 'startDate', 'durationMonths'],
    ),
    compensation: object(
      {
        amount: { type: 'string', pattern: '^(0|[1-9][0-9]*)(\\.[0-9]{1,18})?$' },
        currency: short,
        frequency: enumeration('once', 'hourly', 'monthly', 'milestone'),
      },
      ['amount', 'currency', 'frequency'],
    ),
    workStatus: enumeration('planned', 'active', 'completed', 'canceled', 'disputed'),
    periodOutcomes: {
      type: 'array',
      maxItems: 1200,
      items: object({ month: { type: 'integer', minimum: 1, maximum: 1200 }, outcome: enumeration('success', 'failure') }, ['month', 'outcome']),
    },
    evidence: { ...list({ id: short, description: text, url: text, contentHash: id }, ['id', 'description']), maxItems: 8 },
    cancellationReason: text,
  },
  ['origin', 'title', 'publicDescription', 'workerProfileId', 'hiringProfileIds', 'skillIds', 'terms', 'workStatus', 'periodOutcomes', 'evidence'],
)

const common = {
  from: id,
  objectId: id,
  expectedRevision: integer,
  timestamp: { ...integer, minimum: 1 },
  networkId: id,
  sign: object({ owner: id, sig: { type: 'string', minLength: 1, maxLength: 4096 } }, ['owner', 'sig']),
  fee: { isBigInt: true },
}
const required = Object.keys(common)
const variants: object[] = []
for (const [type, to, payload] of [
  ['profile', profilesAddress, profileContentSchema],
  ['contract', contractsAddress, contractContentSchema],
] as const) {
  for (const action of ['create', 'update'])
    variants.push(
      object({ ...common, type: { const: type }, to: { const: to }, action: { const: action }, payload }, [...required, 'type', 'to', 'action', 'payload']),
    )
}
for (const action of ['request_approval', 'approve', 'reject', 'expire']) {
  const extra = action === 'approve' || action === 'reject' ? { requestHash: id, hiringProfileId: id, ...(action === 'reject' ? { reason: text } : {}) } : {}
  variants.push(
    object({ ...common, type: { const: 'contract' }, to: { const: contractsAddress }, action: { const: action }, ...extra }, [
      ...required,
      'type',
      'to',
      'action',
      ...Object.keys(extra),
    ]),
  )
}
const endorsementContent = object({
  endorserProfileId: id, subjectProfileId: id, skillId: id,
  relationship: enumeration('employer', 'colleague', 'client', 'teacher', 'mentor', 'collaborator', 'other'),
  statement: { ...text, minLength: 1 }, durationMonths: { type: 'integer', minimum: 1, maximum: 12 },
}, ['endorserProfileId', 'subjectProfileId', 'skillId', 'relationship', 'statement', 'durationMonths'])
const skillContent = object({ name: { ...short, minLength: 1 }, description: text, category: short,
  kind: enumeration('technical', 'interpersonal', 'language', 'other') }, ['name', 'description', 'category', 'kind'])
for (const [type, to, payload] of [['endorsement', endorsementsAddress, endorsementContent], ['skill', skillsAddress, skillContent]] as const) {
  variants.push(object({ ...common, type: { const: type }, to: { const: to }, action: { const: 'create' }, payload },
    [...required, 'type', 'to', 'action', 'payload']))
}
variants.push(object({ ...common, type: { const: 'endorsement' }, to: { const: endorsementsAddress }, action: { const: 'revoke' }, reason: { ...text, minLength: 1 } },
  [...required, 'type', 'to', 'action', 'reason']))
export const proofOfSkillSchema = { oneOf: variants }
const ajv = new Ajv({ allErrors: false })
ajv.addKeyword('isBigInt', { validate: (_schema: boolean, value: unknown) => typeof value === 'bigint' && value >= 0n, errors: false })
const validate = ajv.compile(proofOfSkillSchema)

export function validateProofOfSkillShape(tx: unknown): string | undefined {
  return validate(tx) ? undefined : ajv.errorsText(validate.errors)
}
