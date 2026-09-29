# Trust: who stands behind the Universal Agents MCP server

> Who is accountable for https://universalagents.ai/mcp and for each kind of answer it gives, what the `provenance` and `agent_may` fields on its replies mean, and what we do and do not hold.

## The server

- Endpoint: https://universalagents.ai/mcp, streamable-http, read-only.
- Operator: Universal Agents, https://universalagents.ai. The legal entity name is not stated here.
- Accountable: Stu Amos (Founder, CEO), hello@universalagents.ai
- Code authors: Stu Amos (Founder, CEO), Mathew Wendell (Co-founder, COO), Ingo Eichhorst (CTO), Mario Jembrih (Systems Architect)

## The people

- Stu Amos, Founder, CEO. Accountable for the server, its code and its product answers; code author; product answer author.
- Mathew Wendell, Co-founder, COO. Author of, and accountable for, pricing answers; product answer author; code author.
- Ingo Eichhorst, CTO. Code author.
- Mario Jembrih, Systems Architect. Code author.

## Each answer type

### `code`

The server and its code, and what the code makes itself: the request_intro draft.

- Authors: Stu Amos (Founder, CEO), Mathew Wendell (Co-founder, COO), Ingo Eichhorst (CTO), Mario Jembrih (Systems Architect)
- Accountable: Stu Amos (Founder, CEO)
- Source: the server's own code.
- `agent_may`: level 3, Consult. The draft is for the person: the agent proposes it and the person sends it. The server never sends.

### `pricing`

get_pricing, and FAQ answers that quote a price.

- Authors: Mathew Wendell (Co-founder, COO)
- Accountable: Mathew Wendell (Co-founder, COO)
- Source: universalagents-ai/ua-brain, governance/pricing-rules.md, effective 2026-09-28
- `agent_may`: level 1, Tell. Quote as stated, with the ranges and what they depend on. Any discount, custom quote, design-partner or contract term is level 7, Hands Off: it goes to the accountable person via the contact.

### `product`

about_universal_agents, and FAQ answers that quote no price.

- Authors: Stu Amos (Founder, CEO), Mathew Wendell (Co-founder, COO)
- Accountable: Stu Amos (Founder, CEO)
- Source: universalagents-ai/ua-brain, knowledge/01-products-commercial/interplay-lexicon.md, effective 2026-09-28
- `agent_may`: level 1, Tell. Restate as given. Nothing is presented as shipping unless the answer states it.

## The fields on every reply (`provenance_schema` 1)

- `provenance`: answer_type (code, pricing or product); authors, each with name and title; the one accountable person, with name, title and contact; for pricing and product answers, the ua-brain source (repo, path) and the date it took effect. answer_faq carries it on the reply and on each answer.
- `agent_may`: What an agent may do with the answer unsupervised: level, label and note, a level on the Delegation Map Trust Scale, 1 Tell to 7 Hands Off.

agent_may is a level on the Delegation Map Trust Scale (ua-brain governance/delegation.md), from 1 Tell to 7 Hands Off. These are the levels this server uses.

- 1 Tell: The agent may pass the answer on as stated, without asking anyone.
- 3 Consult: The agent may propose; the person decides and acts.
- 7 Hands Off: The agent does not act: the matter goes to the accountable person via the contact.

## What we hold, and what we do not

- Auth: none — public information only, by design
- Attestations: None held: no SOC 2, ISO 27001 or similar certification or audit.
- Signatures: Nothing is signed: not the server card, the ARD manifest or the replies.
- Reads: Public marketing information only: https://universalagents.ai/llms.txt.
- Stores: Nothing a caller sends is stored, except one line per tools/call in the runtime log: the tool name, the client name and version given at initialize, the outcome and the time.
- `request_intro`: Its arguments are never logged. The server drafts the email and sends nothing.

## Machine-readable

- Server card: https://universalagents.ai/.well-known/mcp.json, also at https://universalagents.ai/.well-known/mcp/server-card.json. Its `trust` block carries the server, the fields and what is held; each reply carries its own `provenance` and `agent_may`.
- ARD manifest: https://universalagents.ai/.well-known/ard.json
- Contact: hello@universalagents.ai
