import * as acme from 'acme-client'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '../data')
const CERT_PATH = path.join(DATA_DIR, 'cert.pem')
const KEY_PATH = path.join(DATA_DIR, 'key.pem')
const ACCOUNT_KEY_PATH = path.join(DATA_DIR, 'account-key.pem')

export const challenges = new Map()
const dnsRecordIds = new Map()

const PORKBUN_API = 'https://api.porkbun.com/api/json/v3'

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true })
}

async function loadOrCreateAccountKey() {
  try {
    return await fs.readFile(ACCOUNT_KEY_PATH, 'utf8')
  } catch {
    const key = await acme.crypto.createPrivateKey()
    await fs.writeFile(ACCOUNT_KEY_PATH, key)
    return key
  }
}

async function loadExistingCertificate() {
  try {
    const cert = await fs.readFile(CERT_PATH, 'utf8')
    const key = await fs.readFile(KEY_PATH, 'utf8')
    return { key, cert }
  } catch {
    return null
  }
}

function getDaysUntilExpiry(certPem) {
  const info = acme.crypto.readCertificateInfo(certPem)
  const diff = info.notAfter.getTime() - Date.now()
  return diff / 86_400_000
}

function getBaseDomain(domains) {
  return domains.find(d => !d.startsWith('*')) || domains[0].replace('*.', '')
}

async function porkbunApi(path, body) {
  const res = await fetch(`${PORKBUN_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

function dnsRecordName(authzDomain, baseDomain) {
  const full = `_acme-challenge.${authzDomain}`
  if (full.endsWith(`.${baseDomain}`)) {
    return { name: full.slice(0, -(baseDomain.length + 1)), base: baseDomain }
  }
  return { name: full, base: full }
}

async function createDnsTxtRecord(authzDomain, value, baseDomain, apiKey, secretKey) {
  const { name, base } = dnsRecordName(authzDomain, baseDomain)
  const payload = {
    apikey: apiKey, secretapikey: secretKey,
    name, type: 'TXT', content: value, ttl: '60',
  }
  const result = await porkbunApi(`/dns/create/${base}`, payload)
  if (result.status !== 'SUCCESS') {
    throw new Error(`Porkbun DNS create failed: ${JSON.stringify(result)}`)
  }
  return result
}

async function deleteDnsRecord(recordId, baseDomain, apiKey, secretKey) {
  const result = await porkbunApi(`/dns/delete/${baseDomain}/${recordId}`, {
    apikey: apiKey, secretapikey: secretKey,
  })
  if (result.status !== 'SUCCESS') {
    console.error(`Porkbun DNS delete failed: ${JSON.stringify(result)}`)
  }
}

export async function ensureCertificate(config) {
  await ensureDir()

  const existing = await loadExistingCertificate()
  if (existing) {
    const days = getDaysUntilExpiry(existing.cert)
    console.log(`Certificate expires in ${Math.round(days)} days`)
    if (days > 14) return existing
    console.log('Certificate expiring soon, renewing...')
  }

  const directoryUrl = config.acmeStaging
    ? acme.directory.letsencrypt.staging
    : acme.directory.letsencrypt.production

  const accountKey = await loadOrCreateAccountKey()
  const client = new acme.Client({ directoryUrl, accountKey })

  console.log(`Requesting certificate for: ${config.domains.join(', ')}`)

  const [key, csr] = await acme.crypto.createCsr({
    commonName: config.domains[0],
    altNames: config.domains,
  })

  const baseDomain = getBaseDomain(config.domains)

  const cert = await client.auto({
    csr: Buffer.from(csr),
    email: config.email,
    termsOfServiceAgreed: true,
    challengePriority: ['dns-01', 'http-01'],
    challengeCreateFn: async (authz, challenge, keyAuthorization) => {
      if (challenge.type === 'dns-01') {
        const domain = authz.identifier.value
        console.log(`Creating DNS TXT record: _acme-challenge.${domain}`)
        const result = await createDnsTxtRecord(domain, keyAuthorization, baseDomain, config.porkbunKey, config.porkbunSecret)
        dnsRecordIds.set(challenge.token, { id: result.id, baseDomain })
      } else {
        challenges.set(challenge.token, keyAuthorization)
      }
    },
    challengeRemoveFn: async (authz, challenge) => {
      if (challenge.type === 'dns-01') {
        const record = dnsRecordIds.get(challenge.token)
        if (record) {
          console.log(`Deleting DNS TXT record: _acme-challenge.${authz.identifier.value}`)
          await deleteDnsRecord(record.id, record.baseDomain, config.porkbunKey, config.porkbunSecret)
          dnsRecordIds.delete(challenge.token)
        }
      } else {
        challenges.delete(challenge.token)
      }
    },
  })

  await fs.writeFile(CERT_PATH, cert)
  await fs.writeFile(KEY_PATH, key)

  console.log('Certificate obtained and saved')
  return { key, cert }
}

export function startRenewalTask(getCert, onRenew) {
  const CHECK_INTERVAL = 86_400_000
  const RENEW_BEFORE_DAYS = 30

  const timer = setInterval(async () => {
    try {
      const existing = await loadExistingCertificate()
      if (!existing) return

      const days = getDaysUntilExpiry(existing.cert)
      if (days > RENEW_BEFORE_DAYS) return

      console.log(`Certificate expires in ${Math.round(days)} days, renewing...`)
      const { key, cert } = await getCert()
      onRenew({ key, cert })
      console.log('Certificate renewed')
    } catch (err) {
      console.error('Certificate renewal failed:', err.message)
    }
  }, CHECK_INTERVAL)

  return () => clearInterval(timer)
}
