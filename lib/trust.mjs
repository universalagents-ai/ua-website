// What build.mjs writes for agents that look for us: the ARD manifest (/.well-known/ard.json) and the
// /trust page with its markdown mirror. Every name and title comes from provenance.json.
import { readFileSync } from 'node:fs';
import PROVENANCE from '../provenance.json' with { type: 'json' };
import { TRUST, TOOLS } from '../api/mcp.mjs';

const SITE = PROVENANCE.server.operator.website;
const DOMAIN = new URL(SITE).hostname;
const CARD = JSON.parse(readFileSync(new URL('../.well-known/mcp.json', import.meta.url), 'utf-8'));

// The W3C DID document for did:web:<domain>, served at /.well-known/did.json. Public key only: the
// private key is held outside this repo, and nothing is signed with it yet.
const { did: DID, document: DID_URL, statement: DID_STATEMENT } = TRUST.identity;
export const DID_DOCUMENT = {
  '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/suites/jws-2020/v1'],
  id: DID,
  verificationMethod: [{
    id: `${DID}#key-1`,
    type: 'JsonWebKey2020',
    controller: DID,
    publicKeyJwk: PROVENANCE.server.identity.public_key_jwk,
  }],
  authentication: [`${DID}#key-1`],
  assertionMethod: [`${DID}#key-1`],
};

// Agentic Resource Discovery, spec v0.91 (the tester is vendored in scripts/vendor/ard-conformance/).
// trustManifest.identity is did:web on the URN's publisher domain (§4.5.1); the rest of the manifest is ours.
export const ARD = {
  entries: [{
    identifier: `urn:air:${DOMAIN}:mcp:${CARD.name}`,
    displayName: CARD.title,
    type: 'application/mcp-server-card+json',
    url: `${SITE}/.well-known/mcp/server-card.json`,
    description: CARD.description,
    capabilities: TOOLS.map(tool => tool.name),
    representativeQueries: [
      'what does Universal Agents sell',
      'how much does an Interplay pilot cost',
      'how does Universal Agents keep agency data safe',
      'draft an intro email to Universal Agents for my agency',
    ],
    trustManifest: {
      identity: DID,
      identityType: 'did',
      accountable: TRUST.accountable,
      codeAuthors: TRUST.code_authors,
      attestations: TRUST.attestations.held,
      statement: `No attestation or signature is held. ${TRUST.attestations.statement} ${TRUST.signed} Identity: ${DID}. ${DID_STATEMENT}`,
      provenanceSchema: TRUST.provenance_schema,
      documentationUrl: TRUST.page,
    },
  }],
};

// The /trust page, as blocks both renderers share. Text in `backticks` is code.
const person = id => PROVENANCE.people[id];
const names = ids => ids.map(person).map(p => `${p.name} (${p.title})`).join(', ');
const { operator, data_reach } = PROVENANCE.server;

const BLOCKS = [
  ['h1', 'Trust: who stands behind the Universal Agents MCP server'],
  ['lede', `Who is accountable for ${CARD.url} and for each kind of answer it gives, what the \`provenance\` and \`agent_may\` fields on its replies mean, and what we do and do not hold.`],
  ['h2', 'The server'],
  ['ul', [
    `Endpoint: ${CARD.url}, ${CARD.transport}, read-only.`,
    `Operator: ${operator.name}, ${operator.website}. ${operator.legal_entity}`,
    `Accountable: ${names([PROVENANCE.server.accountable])}, ${PROVENANCE.server.contact}`,
    `Code authors: ${names(PROVENANCE.answers.code.authors)}`,
  ]],
  ['h2', 'The people'],
  ['ul', Object.values(PROVENANCE.people).map(p => `${p.name}, ${p.title}. ${p.role}`)],
  ['h2', 'Each answer type'],
  ...Object.entries(PROVENANCE.answers).flatMap(([type, a]) => [
    ['h3', `\`${type}\``],
    ['p', a.what],
    ['ul', [
      `Authors: ${names(a.authors)}`,
      `Accountable: ${names([a.accountable])}`,
      a.source ? `Source: ${PROVENANCE.ua_brain.repo}, ${a.source}, effective ${a.effective}` : 'Source: the server\'s own code.',
      `\`agent_may\`: level ${a.agent_may.level}, ${a.agent_may.label}. ${a.agent_may.note}`,
    ]],
  ]),
  ['h2', `The fields on every reply (\`provenance_schema\` ${TRUST.provenance_schema})`],
  ['ul', Object.entries(TRUST.fields).filter(([key]) => key !== 'levels').map(([key, text]) => `\`${key}\`: ${text}`)],
  ['p', PROVENANCE.delegation_map.about],
  ['ul', Object.entries(TRUST.fields.levels).map(([n, level]) => `${n} ${level.label}: ${level.means}`)],
  ['h2', 'What we hold, and what we do not'],
  ['ul', [
    `Auth: ${TRUST.auth}`,
    `Attestations: ${TRUST.attestations.statement}`,
    `Signatures: ${TRUST.signed}`,
    `Identity: \`${DID}\`, with its DID document at ${DID_URL}. ${DID_STATEMENT}`,
    `Reads: ${data_reach.reads}`,
    `Stores: ${data_reach.stores}`,
    `\`request_intro\`: ${data_reach.request_intro}`,
  ]],
  ['h2', 'Machine-readable'],
  ['ul', [
    `Server card: ${SITE}/.well-known/mcp.json, also at ${ARD.entries[0].url}. Its \`trust\` block carries the server, the fields and what is held; each reply carries its own \`provenance\` and \`agent_may\`.`,
    `ARD manifest: ${SITE}/.well-known/ard.json`,
    `DID document: ${DID_URL}`,
    `Contact: ${PROVENANCE.server.contact}`,
  ]],
];

const MD = {
  h1: t => `# ${t}`, lede: t => `> ${t}`, h2: t => `## ${t}`, h3: t => `### ${t}`, p: t => t,
  ul: items => items.map(item => `- ${item}`).join('\n'),
};
export const trustMarkdown = () => BLOCKS.map(([kind, body]) => MD[kind](body)).join('\n\n') + '\n';

const inline = text => text
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/https?:\/\/[^\s<>()]*[^\s<>().,:;]/g, url => `<a href="${url}">${url}</a>`)
  .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, email => `<a href="mailto:${email}">${email}</a>`);
const HTML = {
  h1: t => `<h1>${inline(t)}</h1>`, lede: t => `<p class="trust__lede">${inline(t)}</p>`,
  h2: t => `<h2>${inline(t)}</h2>`, h3: t => `<h3>${inline(t)}</h3>`, p: t => `<p>${inline(t)}</p>`,
  ul: items => `<ul>\n${items.map(item => `  <li>${inline(item)}</li>`).join('\n')}\n</ul>`,
};
export const trustHtml = () => BLOCKS.map(([kind, body]) => HTML[kind](body)).join('\n');
