import { useEffect, useMemo, useState } from "react"
import { executePythonProof } from "./api"

type Protocol = "qr" | "schnorr" | "fiat-shamir"
type Mode = "honest" | "adversarial"
type Values = Record<string, string>
type Direction = "local-prover" | "local-verifier" | "to-verifier" | "to-prover" | "result"

type MathWork = {
  formula: string
  substitution: string
  result: string
}

type SequenceStep = {
  phase: string
  title: string
  formula: string
  math?: MathWork
  explanation: string
  direction: Direction
  status?: "pass" | "fail"
}

type ProofRun = {
  accepted: boolean
  claim: string
  probability: string
  steps: SequenceStep[]
}

type Field = {
  key: string
  label: string
  hint: string
  optional?: boolean
  wide?: boolean
  options?: string[]
}

const protocolInfo: Record<Protocol, {
  index: string
  name: string
  short: string
  description: string
  equation: string
  accent: string
}> = {
  qr: {
    index: "01",
    name: "Quadratic Residuosity",
    short: "QR",
    description: "Prove knowledge of a modular square root.",
    equation: "x² ≡ y  (mod N)",
    accent: "#2854d7",
  },
  schnorr: {
    index: "02",
    name: "Schnorr",
    short: "SCH",
    description: "Prove knowledge of a discrete logarithm.",
    equation: "gˣ ≡ Y  (mod p)",
    accent: "#8c4cf0",
  },
  "fiat-shamir": {
    index: "03",
    name: "Fiat–Shamir",
    short: "FS",
    description: "Replace interaction with a hash challenge.",
    equation: "c = H(statement ∥ T)",
    accent: "#d7502f",
  },
}

const defaults: Record<Protocol, Values> = {
  qr: { N: "77", y: "15", x: "13", rounds: "3", z: "53", b_guess: "0" },
  schnorr: {
    p: "23",
    q: "11",
    g: "2",
    x: "3",
    Y: "8",
    rounds: "1",
    z: "5",
    c: "4",
  },
  "fiat-shamir": {
    p: "23",
    q: "11",
    g: "2",
    x: "3",
    Y: "8",
    statement: "Portfolio authentication",
    z: "5",
    c: "4",
  },
}

const fields: Record<Protocol, Record<Mode, Field[]>> = {
  qr: {
    honest: [
      { key: "N", label: "Modulus", hint: "N" },
      { key: "x", label: "Secret witness", hint: "x" },
      { key: "y", label: "Public value", hint: "x² mod N", optional: true },
      {
        key: "rounds",
        label: "Rounds",
        hint: "1–5",
        options: ["1", "2", "3", "4", "5"],
      },
    ],
    adversarial: [
      { key: "N", label: "Modulus", hint: "N" },
      { key: "y", label: "Public value", hint: "y" },
      { key: "z", label: "Fake response", hint: "z" },
      { key: "b_guess", label: "Guessed coin", hint: "b", options: ["0", "1"] },
      {
        key: "rounds",
        label: "Rounds",
        hint: "1–5",
        options: ["1", "2", "3", "4", "5"],
      },
    ],
  },
  schnorr: {
    honest: [
      { key: "p", label: "Prime modulus", hint: "p" },
      { key: "q", label: "Group order", hint: "q" },
      { key: "g", label: "Generator", hint: "g" },
      { key: "x", label: "Secret key", hint: "x" },
      { key: "Y", label: "Public key", hint: "gˣ mod p", optional: true },
      {
        key: "rounds",
        label: "Rounds",
        hint: "1–5",
        options: ["1", "2", "3", "4", "5"],
      },
    ],
    adversarial: [
      { key: "p", label: "Prime modulus", hint: "p" },
      { key: "q", label: "Group order", hint: "q" },
      { key: "g", label: "Generator", hint: "g" },
      { key: "Y", label: "Public key", hint: "Y" },
      { key: "z", label: "Fake response", hint: "z" },
      { key: "c", label: "Guessed challenge", hint: "c" },
      {
        key: "rounds",
        label: "Rounds",
        hint: "1–5",
        options: ["1", "2", "3", "4", "5"],
      },
    ],
  },
  "fiat-shamir": {
    honest: [
      { key: "p", label: "Prime modulus", hint: "p" },
      { key: "q", label: "Group order", hint: "q" },
      { key: "g", label: "Generator", hint: "g" },
      { key: "x", label: "Secret key", hint: "x" },
      { key: "Y", label: "Public key", hint: "gˣ mod p", optional: true },
      {
        key: "statement",
        label: "Public statement",
        hint: "Bound to the proof",
        wide: true,
      },
    ],
    adversarial: [
      { key: "p", label: "Prime modulus", hint: "p" },
      { key: "q", label: "Group order", hint: "q" },
      { key: "g", label: "Generator", hint: "g" },
      { key: "Y", label: "Public key", hint: "Y" },
      { key: "z", label: "Fake response", hint: "z" },
      { key: "c", label: "Guessed hash", hint: "c" },
      {
        key: "statement",
        label: "Public statement",
        hint: "Bound to the proof",
        wide: true,
      },
    ],
  },
}

function mod(value: number, modulus: number) {
  return ((value % modulus) + modulus) % modulus
}

function modPow(base: number, exponent: number, modulus: number) {
  let result = 1
  let current = mod(base, modulus)
  let power = exponent
  while (power > 0) {
    if (power % 2 === 1) result = (result * current) % modulus
    current = (current * current) % modulus
    power = Math.floor(power / 2)
  }
  return result
}

function gcd(a: number, b: number) {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y) [x, y] = [y, x % y]
  return x
}

function inverse(value: number, modulus: number) {
  let [oldR, r] = [value, modulus]
  let [oldS, s] = [1, 0]
  while (r) {
    const quotient = Math.floor(oldR / r)
    ;[oldR, r] = [r, oldR - quotient * r]
    ;[oldS, s] = [s, oldS - quotient * s]
  }
  if (Math.abs(oldR) !== 1)
    throw new Error("The selected value has no modular inverse.")
  return mod(oldS, modulus)
}

function randomInt(max: number) {
  if (max <= 1) return 0
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  return buffer[0] % max
}

function randomUnit(N: number) {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const candidate = 2 + randomInt(Math.max(1, N - 2))
    if (gcd(candidate, N) === 1) return candidate
  }
  throw new Error("No invertible random mask could be found for this modulus.")
}

function readNumber(values: Values, key: string, optional = false) {
  if (optional && !values[key]?.trim()) return undefined
  const parsed = Number(values[key])
  if (!Number.isSafeInteger(parsed))
    throw new Error(`${key} must be a whole number.`)
  return parsed
}

function validateGroup(p: number, q: number, g: number, x?: number) {
  if (p < 3 || q < 2) throw new Error("p and q must be positive integers.")
  if ((p - 1) % q !== 0)
    throw new Error(`q must divide p − 1. Here, p − 1 = ${p - 1}.`)
  if (g < 2 || modPow(g, q, p) !== 1)
    throw new Error("g must satisfy g^q mod p = 1.")
  if (x !== undefined && (x < 1 || x >= q))
    throw new Error(`x must be between 1 and ${q - 1}.`)
}

async function hashChallenge(statement: string, T: number, q: number) {
  const bytes = new TextEncoder().encode(`${statement}|${T}`)
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
  return digest.reduce((remainder, byte) => (remainder * 256 + byte) % q, 0)
}

function localProver(
  phase: string,
  title: string,
  expression: string | MathWork,
  explanation: string,
): SequenceStep {
  return {
    phase,
    title,
    formula: typeof expression === "string" ? expression : expression.result,
    math: typeof expression === "string" ? undefined : expression,
    explanation,
    direction: "local-prover",
  }
}

function localVerifier(
  phase: string,
  title: string,
  expression: string | MathWork,
  explanation: string,
): SequenceStep {
  return {
    phase,
    title,
    formula: typeof expression === "string" ? expression : expression.result,
    math: typeof expression === "string" ? undefined : expression,
    explanation,
    direction: "local-verifier",
  }
}

function message(
  direction: "to-verifier" | "to-prover",
  phase: string,
  title: string,
  formula: string,
  explanation: string,
): SequenceStep {
  return { phase, title, formula, explanation, direction }
}

async function createRun(
  protocol: Protocol,
  mode: Mode,
  values: Values,
): Promise<ProofRun> {
  if (protocol === "qr") {
    const N = readNumber(values, "N")!
    const rounds = readNumber(values, "rounds")!
    if (N < 4 || rounds < 1 || rounds > 5)
      throw new Error("Use N ≥ 4 and between 1 and 5 rounds.")

    if (mode === "honest") {
      const x = readNumber(values, "x")!
      const y = modPow(x, 2, N)
      const suppliedY = readNumber(values, "y", true)
      if (suppliedY !== undefined && suppliedY !== y) {
        throw new Error(`For x = ${x}, y must be ${y}, not ${suppliedY}.`)
      }
      const r = randomUnit(N)
      const s = modPow(r, 2, N)
      const b = randomInt(2)
      const z = b === 0 ? mod(r * x, N) : r
      const left = modPow(z, 2, N)
      const right = b === 0 ? mod(s * y, N) : s
      return {
        accepted: left === right,
        claim: `I know x such that x² ≡ ${y} (mod ${N})`,
        probability: `1 / ${2 ** rounds}`,
        steps: [
          localProver(
            "PRIVATE INPUT",
            "The prover starts with the witness",
            `x = ${x}`,
            `x stays on the prover’s side. The verifier only knows N = ${N} and y = ${y}.`,
          ),
          localProver(
            "RANDOM MASK",
            "Choose a fresh random unit",
            `r = ${r},  gcd(r, ${N}) = 1`,
            "A new random mask prevents the response from exposing the witness.",
          ),
          localProver(
            "COMPUTE COMMITMENT",
            "Square the mask modulo N",
            {
              formula: "s = r² mod N",
              substitution: `s = ${r}² mod ${N}`,
              result: `s = ${s}`,
            },
            "The commitment fixes this particular random mask before the verifier chooses b. The value s reveals only the square of r modulo N, not the witness x.",
          ),
          message(
            "to-verifier",
            "COMMITMENT",
            "Prover sends s",
            `s = ${s}`,
            "The commitment crosses to the verifier. The secret x does not.",
          ),
          localVerifier(
            "RANDOM CHALLENGE",
            "Flip a challenge coin",
            `b = ${b}`,
            "The verifier chooses b only after receiving s, so the prover cannot prepare for both branches.",
          ),
          message(
            "to-prover",
            "CHALLENGE",
            `Verifier sends b = ${b}`,
            b === 0
              ? "prove knowledge of x through the mask"
              : "open the random mask",
            "The one-bit challenge determines which relationship the prover must demonstrate.",
          ),
          localProver(
            "COMPUTE RESPONSE",
            b === 0
              ? "Blend the witness with the mask"
              : "Reveal only the mask",
            b === 0
              ? {
                  formula: "z = r · x mod N",
                  substitution: `z = ${r} · ${x} mod ${N}`,
                  result: `z = ${z}`,
                }
              : {
                  formula: "z = r",
                  substitution: `z = ${r}`,
                  result: `z = ${z}`,
                },
            b === 0
              ? "For b = 0, multiplying x by the fresh random r masks the witness. The verifier can test the relationship because z² = r²x² = s·y, but cannot separate x from r."
              : "For b = 1, the prover opens the random mask itself. The verifier checks that the earlier commitment really was s = r², without receiving any value involving x.",
          ),
          message(
            "to-verifier",
            "RESPONSE",
            "Prover sends z",
            `z = ${z}`,
            "The verifier now has exactly one answer for this commitment.",
          ),
          {
            ...localVerifier(
              "VERIFY",
              "Check the challenge equation",
              b === 0
                ? {
                    formula: "z² mod N = s · y mod N",
                    substitution: `${z}² mod ${N} = ${s} · ${y} mod ${N}`,
                    result: `${left} = ${right}`,
                  }
                : {
                    formula: "z² mod N = s",
                    substitution: `${z}² mod ${N} = ${s}`,
                    result: `${left} = ${right}`,
                  },
              left === right
                ? b === 0
                  ? "The equality holds because z = r·x, s = r², and y = x². Squaring z therefore produces r²x², exactly the same product represented by s·y."
                  : "The equality holds because z is the opened mask r and the commitment was constructed as s = r² mod N."
                : "The two sides differ, so the proof is rejected.",
            ),
            status: left === right ? "pass" : "fail",
          },
          {
            phase: "ROUND COMPLETE",
            title: left === right ? "Proof accepted" : "Proof rejected",
            formula:
              rounds > 1
                ? `Repeat the cycle ${rounds}×  →  fraud chance ${1}/${2 ** rounds}`
                : "One round complete",
            explanation: `Each fresh round forces a new commitment before a new random challenge. The witness x = ${x} is never transmitted.`,
            direction: "result",
            status: left === right ? "pass" : "fail",
          },
        ],
      }
    }

    const y = readNumber(values, "y")!
    const z = readNumber(values, "z")!
    const guessedB = readNumber(values, "b_guess")!
    if (![0, 1].includes(guessedB))
      throw new Error("The guessed coin must be 0 or 1.")
    if (gcd(z, N) !== 1) throw new Error("z must be coprime to N.")
    const s =
      guessedB === 1 ? modPow(z, 2, N) : mod(modPow(z, 2, N) * inverse(y, N), N)
    const actualB = randomInt(2)
    const left = modPow(z, 2, N)
    const right = actualB === 0 ? mod(s * y, N) : s
    let accepted = left === right
    for (let round = 2; round <= rounds && accepted; round += 1) {
      const nextZ = randomUnit(N)
      const nextGuess = randomInt(2)
      const nextS =
        nextGuess === 1
          ? modPow(nextZ, 2, N)
          : mod(modPow(nextZ, 2, N) * inverse(y, N), N)
      const nextChallenge = randomInt(2)
      accepted =
        modPow(nextZ, 2, N) ===
        (nextChallenge === 0 ? mod(nextS * y, N) : nextS)
    }
    return {
      accepted,
      claim: `Attempt to fake knowledge of a square root of y = ${y}`,
      probability: `1 / ${2 ** rounds}`,
      steps: [
        localProver(
          "MISSING WITNESS",
          "The Fraud Prover does not know x",
          `public: N = ${N}, y = ${y}   ·   private: x = ?`,
          "To answer both possible challenges for the same commitment, the Fraud Prover would need values z₀ = r·x and z₁ = r. Their ratio reveals x = z₀·z₁⁻¹ mod N—the missing square root of y.",
        ),
        localProver(
          "BET ON CHALLENGE",
          "Guess the verifier’s coin in advance",
          `b̂ = ${guessedB}`,
          "The entire forgery is built to pass only this guessed branch.",
        ),
        localProver(
          "PICK RESPONSE FIRST",
          "Work backwards from a fake response",
          `z = ${z}`,
          "An honest prover commits before seeing b. The Fraud Prover reverses that order: choose z first, guess b, then manufacture an s that satisfies only the guessed equation.",
        ),
        localProver(
          "FABRICATE COMMITMENT",
          "Construct s for the guessed branch",
          guessedB === 0
            ? {
                formula: "s = z² · y⁻¹ mod N",
                substitution: `s = ${z}² · ${y}⁻¹ mod ${N}`,
                result: `s = ${s}`,
              }
            : {
                formula: "s = z² mod N",
                substitution: `s = ${z}² mod ${N}`,
                result: `s = ${s}`,
              },
          guessedB === 0
            ? "This forces z² = s·y, so the b = 0 equation will pass. It does not also prove z² = s for b = 1."
            : "This forces z² = s, so the b = 1 equation will pass. Answering b = 0 for the same s would require the unknown square root x.",
        ),
        message(
          "to-verifier",
          "COMMITMENT",
          "Fraud Prover sends fabricated s",
          `s = ${s}`,
          "The verifier cannot yet see which challenge was predicted.",
        ),
        localVerifier(
          "RANDOM CHALLENGE",
          "Flip an independent coin",
          `b = ${actualB}`,
          "The verifier chooses independently of the Fraud Prover’s guess. That independence is what gives each round a one-half cheating probability.",
        ),
        message(
          "to-prover",
          "CHALLENGE",
          `Verifier sends b = ${actualB}`,
          `guess was b̂ = ${guessedB}`,
          "Now the forgery either matches by luck or fails.",
        ),
        message(
          "to-verifier",
          "FAKE RESPONSE",
          "Fraud Prover sends the preselected z",
          `z = ${z}`,
          "The response cannot be adapted without knowing x.",
        ),
        {
          ...localVerifier(
            "VERIFY",
            "Test the response against the real challenge",
            actualB === 0
              ? {
                  formula: "z² mod N = s · y mod N",
                  substitution: `${z}² mod ${N} = ${s} · ${y} mod ${N}`,
                  result: `${left} ${left === right ? "=" : "≠"} ${right}`,
                }
              : {
                  formula: "z² mod N = s",
                  substitution: `${z}² mod ${N} = ${s}`,
                  result: `${left} ${left === right ? "=" : "≠"} ${right}`,
                },
            left === right
              ? "The guess matched in this displayed round."
              : "The real challenge selected the equation the fabricated commitment was not built to satisfy. Producing the missing response would require knowing x.",
          ),
          status: left === right ? "pass" : "fail",
        },
        {
          phase: "ATTEMPT COMPLETE",
          title: accepted
            ? "Forgery accepted by chance"
            : "Fraud Prover caught",
          formula: `success probability after ${rounds} round${
            rounds === 1 ? "" : "s"
          }: 1/${2 ** rounds}`,
          explanation:
            "Repeating the commitment–challenge–response cycle drives the probability of a lucky forgery down exponentially.",
          direction: "result",
          status: accepted ? "pass" : "fail",
        },
      ],
    }
  }

  const p = readNumber(values, "p")!
  const q = readNumber(values, "q")!
  const g = readNumber(values, "g")!
  const x = mode === "honest" ? readNumber(values, "x")! : undefined
  validateGroup(p, q, g, x)
  const Y = x === undefined ? readNumber(values, "Y")! : modPow(g, x, p)
  const suppliedY = readNumber(values, "Y", true)
  if (x !== undefined && suppliedY !== undefined && suppliedY !== Y) {
    throw new Error(`For x = ${x}, Y must be ${Y}, not ${suppliedY}.`)
  }

  if (protocol === "schnorr") {
    const rounds = readNumber(values, "rounds")!
    if (rounds < 1 || rounds > 5) throw new Error("Use between 1 and 5 rounds.")

    if (mode === "honest") {
      const k = 1 + randomInt(q - 1)
      const T = modPow(g, k, p)
      const c = randomInt(q)
      const z = mod(k + c * x!, q)
      const left = modPow(g, z, p)
      const right = mod(T * modPow(Y, c, p), p)
      return {
        accepted: left === right,
        claim: `I know x such that ${g}ˣ ≡ ${Y} (mod ${p})`,
        probability: `1 / ${q ** rounds}`,
        steps: [
          localProver(
            "PRIVATE INPUT",
            "The prover holds the secret key",
            `x = ${x}`,
            `The verifier knows p = ${p}, q = ${q}, g = ${g}, and Y = ${Y}.`,
          ),
          localProver(
            "FRESH NONCE",
            "Choose a one-time nonce",
            `k = ${k}`,
            "The nonce masks x and must never be reused.",
          ),
          localProver(
            "COMPUTE COMMITMENT",
            "Exponentiate the generator",
            {
              formula: "T = gᵏ mod p",
              substitution: `T = ${g}^${k} mod ${p}`,
              result: `T = ${T}`,
            },
            "T is the public group element produced by the private nonce k. Sending T first prevents the prover from choosing k after learning the challenge.",
          ),
          message(
            "to-verifier",
            "COMMITMENT",
            "Prover sends T",
            `T = ${T}`,
            "Only the public group element crosses the channel.",
          ),
          localVerifier(
            "RANDOM CHALLENGE",
            "Choose a challenge from Zq",
            `c = ${c}`,
            `There are ${q} possible challenges, making a blind guess succeed with probability 1/${q}.`,
          ),
          message(
            "to-prover",
            "CHALLENGE",
            "Verifier sends c",
            `c = ${c}`,
            "The unpredictable challenge binds the commitment to the claimed key.",
          ),
          localProver(
            "COMPUTE RESPONSE",
            "Blend nonce and secret",
            {
              formula: "z = k + c·x mod q",
              substitution: `z = ${k} + ${c}·${x} mod ${q}`,
              result: `z = ${z}`,
            },
            "The response contains the secret only inside a sum masked by the fresh nonce k. All scalar arithmetic uses q because k, c, x, and z belong to the subgroup exponent space.",
          ),
          message(
            "to-verifier",
            "RESPONSE",
            "Prover sends z",
            `z = ${z}`,
            "The verifier receives a scalar response, never x.",
          ),
          {
            ...localVerifier(
              "VERIFY",
              "Check the Schnorr equation",
              {
                formula: "gᶻ mod p = T · Yᶜ mod p",
                substitution: `${g}^${z} mod ${p} = ${T} · ${Y}^${c} mod ${p}`,
                result: `${left} = ${right}`,
              },
              left === right
                ? "The equation works because gᶻ = g^(k+c·x) = gᵏ·(gˣ)ᶜ. Substituting the public values T = gᵏ and Y = gˣ gives exactly T·Yᶜ."
                : "The equation does not balance.",
            ),
            status: left === right ? "pass" : "fail",
          },
          {
            phase: "ROUND COMPLETE",
            title: left === right ? "Proof accepted" : "Proof rejected",
            formula:
              rounds > 1
                ? `Repeat ${rounds}×  →  fraud chance 1/${q ** rounds}`
                : `fraud chance 1/${q}`,
            explanation:
              "The verifier learns that a consistent secret exists, but the nonce keeps that secret hidden.",
            direction: "result",
            status: left === right ? "pass" : "fail",
          },
        ],
      }
    }

    const z = readNumber(values, "z")!
    const guessedC = readNumber(values, "c")!
    if (z < 0 || z >= q || guessedC < 0 || guessedC >= q)
      throw new Error(`z and c must be between 0 and ${q - 1}.`)
    const T = mod(modPow(g, z, p) * modPow(inverse(Y, p), guessedC, p), p)
    const actualC = randomInt(q)
    const left = modPow(g, z, p)
    const right = mod(T * modPow(Y, actualC, p), p)
    let accepted = left === right
    for (let round = 2; round <= rounds && accepted; round += 1) {
      const nextZ = randomInt(q)
      const nextGuess = randomInt(q)
      const nextT = mod(
        modPow(g, nextZ, p) * modPow(inverse(Y, p), nextGuess, p),
        p,
      )
      const nextChallenge = randomInt(q)
      accepted =
        modPow(g, nextZ, p) === mod(nextT * modPow(Y, nextChallenge, p), p)
    }
    return {
      accepted,
      claim: `Attempt to fake knowledge of the discrete log of Y = ${Y}`,
      probability: `1 / ${q ** rounds}`,
      steps: [
        localProver(
          "MISSING SECRET",
          "The Fraud Prover does not know x",
          `Y = ${Y},  x = ?`,
          "The public key is Y = gˣ mod p. Recovering x from Y is the discrete logarithm problem, which is designed to be infeasible in a large, correctly chosen group.",
        ),
        localProver(
          "GUESS CHALLENGE",
          "Choose the challenge to target",
          `ĉ = ${guessedC}`,
          `Only one of the ${q} possible challenges is prepared.`,
        ),
        localProver(
          "PICK RESPONSE FIRST",
          "Choose a fake response",
          `z = ${z}`,
          "The Fraud Prover reverses the honest order: choose z and a target challenge first, then calculate a commitment that passes for that one challenge.",
        ),
        localProver(
          "FABRICATE COMMITMENT",
          "Solve the verification equation backwards",
          {
            formula: "T = gᶻ · Y⁻ᶜ mod p",
            substitution: `T = ${g}^${z} · ${Y}^(-${guessedC}) mod ${p}`,
            result: `T = ${T}`,
          },
          "Rearranging gᶻ = T·Yᶜ lets the Fraud Prover manufacture T for one chosen c. A different challenge changes Yᶜ, and adjusting the response would require the unknown x.",
        ),
        message(
          "to-verifier",
          "COMMITMENT",
          "Fraud Prover sends T",
          `T = ${T}`,
          "The verifier now chooses independently.",
        ),
        localVerifier(
          "RANDOM CHALLENGE",
          "Choose c from Zq",
          `c = ${actualC}`,
          `The Fraud Prover predicted ĉ = ${guessedC}.`,
        ),
        message(
          "to-prover",
          "CHALLENGE",
          "Verifier sends c",
          `c = ${actualC}`,
          "The commitment is already fixed and cannot be changed.",
        ),
        message(
          "to-verifier",
          "FAKE RESPONSE",
          "Fraud Prover sends z",
          `z = ${z}`,
          "The preselected response is tested against the actual c.",
        ),
        {
          ...localVerifier(
            "VERIFY",
            "Check the Schnorr equation",
            {
              formula: "gᶻ mod p = T · Yᶜ mod p",
              substitution: `${g}^${z} mod ${p} = ${T} · ${Y}^${actualC} mod ${p}`,
              result: `${left} ${left === right ? "=" : "≠"} ${right}`,
            },
            left === right
              ? "The displayed challenge matched by chance."
              : "The actual c differs from the targeted challenge, so the right-hand side changes while the fixed response z does not. The forged equation no longer balances.",
          ),
          status: left === right ? "pass" : "fail",
        },
        {
          phase: "ATTEMPT COMPLETE",
          title: accepted
            ? "Forgery accepted by chance"
            : "Fraud Prover caught",
          formula: `success probability: 1/${q ** rounds}`,
          explanation:
            "A new unpredictable challenge in every round makes a sustained forgery infeasible.",
          direction: "result",
          status: accepted ? "pass" : "fail",
        },
      ],
    }
  }

  const statement = values.statement?.trim()
  if (!statement) throw new Error("Enter a public statement.")

  if (mode === "honest") {
    const k = 1 + randomInt(q - 1)
    const T = modPow(g, k, p)
    const c = await hashChallenge(statement, T, q)
    const z = mod(k + c * x!, q)
    const checkedC = await hashChallenge(statement, T, q)
    const left = modPow(g, z, p)
    const right = mod(T * modPow(Y, checkedC, p), p)
    return {
      accepted: left === right,
      claim: `Proof of knowledge bound to “${statement}”`,
      probability: `1 / ${q}`,
      steps: [
        localProver(
          "PRIVATE INPUT",
          "The prover holds the secret key",
          `x = ${x}`,
          `Public key Y = ${Y}. The secret never leaves the prover.`,
        ),
        localProver(
          "FRESH NONCE",
          "Choose a one-time nonce",
          `k = ${k}`,
          "Fresh randomness prevents proofs from being linked or reused.",
        ),
        localProver(
          "COMPUTE COMMITMENT",
          "Create the Schnorr commitment",
          {
            formula: "T = gᵏ mod p",
            substitution: `T = ${g}^${k} mod ${p}`,
            result: `T = ${T}`,
          },
          "As in interactive Schnorr, T commits the prover to a fresh nonce k. The difference is that no online verifier needs to generate the challenge.",
        ),
        localProver(
          "BIND CONTEXT",
          "Combine statement and commitment",
          `“${statement}” ∥ T=${T}`,
          "Changing either input creates a different hash challenge.",
        ),
        localProver(
          "HASH CHALLENGE",
          "Let SHA-256 act as the verifier",
          {
            formula: "c = SHA-256(statement ∥ T) mod q",
            substitution: `c = SHA-256(“${statement}” ∥ ${T}) mod ${q}`,
            result: `c = ${c}`,
          },
          "The hash behaves as a deterministic but unpredictable challenge. Because c depends on both the statement and T, the prover must fix the commitment before learning which challenge that commitment creates.",
        ),
        localProver(
          "COMPUTE RESPONSE",
          "Blend nonce and secret",
          {
            formula: "z = k + c·x mod q",
            substitution: `z = ${k} + ${c}·${x} mod ${q}`,
            result: `z = ${z}`,
          },
          "The proof contains (T, z), not k or x. The fresh nonce masks x in the same way as interactive Schnorr.",
        ),
        message(
          "to-verifier",
          "PUBLISH PROOF",
          "Send the non-interactive proof",
          `(T, z) = (${T}, ${z})`,
          `The public statement “${statement}” travels alongside the proof.`,
        ),
        localVerifier(
          "RECOMPUTE HASH",
          "Derive c independently",
          {
            formula: "c′ = SHA-256(statement ∥ T) mod q",
            substitution: `c′ = SHA-256(“${statement}” ∥ ${T}) mod ${q}`,
            result: `c′ = ${checkedC}`,
          },
          "The verifier rebuilds the challenge from the received public data. A proof copied to another statement produces a different c′ and no longer satisfies the verification equation.",
        ),
        {
          ...localVerifier(
            "VERIFY",
            "Check the Schnorr equation",
            {
              formula: "gᶻ mod p = T · Yᶜ′ mod p",
              substitution: `${g}^${z} mod ${p} = ${T} · ${Y}^${checkedC} mod ${p}`,
              result: `${left} = ${right}`,
            },
            left === right
              ? "The equality proves that z is consistent with one nonce k and the secret exponent x for the exact statement that produced c′."
              : "The proof does not verify.",
          ),
          status: left === right ? "pass" : "fail",
        },
        {
          phase: "PROOF COMPLETE",
          title:
            left === right
              ? "Non-interactive proof accepted"
              : "Proof rejected",
          formula: "No challenge message was exchanged",
          explanation:
            "Fiat–Shamir preserves the commitment–challenge–response structure, but derives the challenge deterministically from public data.",
          direction: "result",
          status: left === right ? "pass" : "fail",
        },
      ],
    }
  }

  const z = readNumber(values, "z")!
  const guessedC = readNumber(values, "c")!
  if (z < 0 || z >= q || guessedC < 0 || guessedC >= q)
    throw new Error(`z and c must be between 0 and ${q - 1}.`)
  const T = mod(modPow(g, z, p) * modPow(inverse(Y, p), guessedC, p), p)
  const actualC = await hashChallenge(statement, T, q)
  const left = modPow(g, z, p)
  const right = mod(T * modPow(Y, actualC, p), p)
  const accepted = left === right
  return {
    accepted,
    claim: `Attempt to forge a proof bound to “${statement}”`,
    probability: `1 / ${q}`,
    steps: [
      localProver(
        "MISSING SECRET",
        "The Fraud Prover does not know x",
        `Y = ${Y},  x = ?`,
        "The proof must be fabricated without the discrete logarithm.",
      ),
      localProver(
        "TARGET HASH",
        "Guess the future hash challenge",
        `ĉ = ${guessedC}`,
        `The hash has ${q} possible outputs in this educational group.`,
      ),
      localProver(
        "PICK RESPONSE FIRST",
        "Choose a fake response",
        `z = ${z}`,
        "The Fraud Prover chooses a response and hoped-for hash output first, then works backwards to manufacture a matching commitment.",
      ),
      localProver(
        "FABRICATE COMMITMENT",
        "Construct T for the guessed challenge",
        {
          formula: "T = gᶻ · Y⁻ᶜ mod p",
          substitution: `T = ${g}^${z} · ${Y}^(-${guessedC}) mod ${p}`,
          result: `T = ${T}`,
        },
        "This T satisfies the Schnorr equation only for the guessed ĉ. But changing T also changes SHA-256(statement ∥ T), creating a circular problem the Fraud Prover cannot control.",
      ),
      message(
        "to-verifier",
        "PUBLISH FORGERY",
        "Send statement and fake proof",
        `(T, z) = (${T}, ${z})`,
        "Unlike interactive Schnorr, there is no second chance to answer a live challenge.",
      ),
      localVerifier(
        "BIND CONTEXT",
        "Combine the received statement and T",
        `“${statement}” ∥ T=${T}`,
        "Any change to the statement changes the challenge.",
      ),
      localVerifier(
        "HASH CHALLENGE",
        "Compute the real challenge",
        {
          formula: "c = SHA-256(statement ∥ T) mod q",
          substitution: `c = SHA-256(“${statement}” ∥ ${T}) mod ${q}`,
          result: `c = ${actualC}`,
        },
        `The Fraud Prover targeted ĉ = ${guessedC}, but the hash output is determined by the published statement and commitment.`,
      ),
      localVerifier(
        "RECONSTRUCT CHECK",
        "Evaluate the verification equation",
        {
          formula: "gᶻ mod p = T · Yᶜ mod p",
          substitution: `${g}^${z} mod ${p} = ${T} · ${Y}^${actualC} mod ${p}`,
          result: `${left} ${left === right ? "=" : "≠"} ${right}`,
        },
        "The verifier uses the actual hash-derived c, not the Fraud Prover’s guess. Without x, the Fraud Prover cannot repair z after seeing that hash output.",
      ),
      {
        ...localVerifier(
          "VERIFY",
          accepted
            ? "The hash matched by chance"
            : "The hash defeats the forgery",
          `${actualC} ${actualC === guessedC ? "=" : "≠"} ${guessedC}`,
          accepted
            ? "This toy attempt succeeded with probability 1/q."
            : "The fabricated proof was built for the wrong challenge.",
        ),
        status: accepted ? "pass" : "fail",
      },
      {
        phase: "ATTEMPT COMPLETE",
        title: accepted ? "Forgery accepted by chance" : "Fraud Prover caught",
        formula: `one-attempt success probability: 1/${q}`,
        explanation:
          "In real groups q is enormous, making it infeasible to keep guessing until the hash matches.",
        direction: "result",
        status: accepted ? "pass" : "fail",
      },
    ],
  }
}

function MathBlock({ step }: { step: SequenceStep }) {
  if (!step.math) return <code className="single-value">{step.formula}</code>

  return (
    <div className="math-work">
      <div>
        <span>Formula</span>
        <code>{step.math.formula}</code>
      </div>
      <div>
        <span>Substitute</span>
        <code>{step.math.substitution}</code>
      </div>
      <div className="math-result">
        <span>Result</span>
        <code>{step.math.result}</code>
      </div>
    </div>
  )
}

function ActorIcon({ verifier = false }: { verifier?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {verifier ? (
        <>
          <path d="M12 3 5.5 5.6v5.7c0 4.2 2.6 7.8 6.5 9.7 3.9-1.9 6.5-5.5 6.5-9.7V5.6L12 3Z" />
          <path d="m9 12 2 2 4-4" />
        </>
      ) : (
        <>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5.5 20c.6-4 2.8-6 6.5-6s5.9 2 6.5 6" />
          <path d="M17.5 7.5h3m-1.5-1.5v3" />
        </>
      )}
    </svg>
  )
}

function ExchangeVisual({
  direction,
  active,
  status,
}: {
  direction: Direction
  active: boolean
  status?: "pass" | "fail"
}) {
  if (direction === "local-prover" || direction === "local-verifier") {
    return (
      <div
        className={`local-pulse ${
          direction === "local-verifier" ? "right" : ""
        } ${active ? "active" : ""}`}
      >
        <span />
        <span />
        <span />
      </div>
    )
  }
  if (direction === "result")
    return (
      <div className={`result-burst ${active ? "active" : ""}`}>
        <span>{status === "fail" ? "×" : "✓"}</span>
      </div>
    )
  return (
    <div className={`message-line ${direction} ${active ? "active" : ""}`}>
      <span className="moving-packet" />
    </div>
  )
}

export default function App() {
  const [protocol, setProtocol] = useState<Protocol>("qr")
  const [mode, setMode] = useState<Mode>("honest")
  const [allValues, setAllValues] = useState<Record<Protocol, Values>>(defaults)
  const [run, setRun] = useState<ProofRun | null>(null)
  const [activeStep, setActiveStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState("")
  const [computing, setComputing] = useState(false)
  const info = protocolInfo[protocol]
  const values = allValues[protocol]
  const activeFields = useMemo(() => fields[protocol][mode], [protocol, mode])

  useEffect(() => {
    if (!playing || !run) return
    if (activeStep >= run.steps.length - 1) {
      setPlaying(false)
      return
    }
    const timer = window.setTimeout(
      () => setActiveStep((step) => step + 1),
      2800,
    )
    return () => window.clearTimeout(timer)
  }, [playing, activeStep, run])

  const resetRun = () => {
    setRun(null)
    setPlaying(false)
    setActiveStep(0)
    setError("")
  }

  const chooseProtocol = (next: Protocol) => {
    setProtocol(next)
    resetRun()
  }

  const chooseMode = (next: Mode) => {
    setMode(next)
    resetRun()
  }

  const updateValue = (key: string, value: string) => {
    setAllValues((current) => ({
      ...current,
      [protocol]: { ...current[protocol], [key]: value },
    }))
    setError("")
  }

  const execute = async () => {
    setComputing(true)
    setError("")
    try {
      const nextRun = await createRun(protocol, mode, values)
      setRun(nextRun)
      setActiveStep(0)
      setPlaying(true)
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : "The protocol could not be executed.",
      )
    } finally {
      setComputing(false)
    }
  }

  const visibleSteps = run?.steps ?? []

  return (
    <main
      className="engine"
      style={{ "--accent": info.accent } as React.CSSProperties}
    >
      <header className="app-header">
        <div className="identity">
          <span className="identity-mark">ZK</span>
          <div>
            <h1>Zero-Knowledge Proof Engine</h1>
            <p>Interactive protocol visualizer</p>
          </div>
        </div>
        <div className="engine-status">
          <span /> Browser engine ready
        </div>
      </header>

      <nav className="protocol-nav" aria-label="Select protocol">
        {(Object.keys(protocolInfo) as Protocol[]).map((key) => {
          const item = protocolInfo[key]
          return (
            <button
              type="button"
              key={key}
              className={protocol === key ? "active" : ""}
              onClick={() => chooseProtocol(key)}
            >
              <span>{item.index}</span>
              <div>
                <strong>{item.name}</strong>
                <small>{item.description}</small>
              </div>
              <b>{item.short}</b>
            </button>
          )
        })}
      </nav>

      <div className="engine-layout">
        <aside className="control-panel">
          <div className="control-title">
            <p>PROTOCOL PARAMETERS</p>
            <h2>{info.name}</h2>
            <code>{info.equation}</code>
          </div>

          <div className="mode-control">
            <button
              type="button"
              className={mode === "honest" ? "active" : ""}
              onClick={() => chooseMode("honest")}
            >
              Honest prover
            </button>
            <button
              type="button"
              className={mode === "adversarial" ? "active danger" : ""}
              onClick={() => chooseMode("adversarial")}
            >
              Fraud Prover
            </button>
          </div>

          <div className="parameter-grid">
            {activeFields.map((field) => (
              <label key={field.key} className={field.wide ? "wide" : ""}>
                <span>
                  {field.label}
                  {field.optional && <em>optional</em>}
                </span>
                <div>
                  {field.options ? (
                    <select
                      value={values[field.key]}
                      onChange={(event) =>
                        updateValue(field.key, event.target.value)
                      }
                    >
                      {field.options.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      inputMode={field.key === "statement" ? "text" : "numeric"}
                      value={values[field.key] ?? ""}
                      onChange={(event) =>
                        updateValue(field.key, event.target.value)
                      }
                    />
                  )}
                  <small>{field.hint}</small>
                </div>
              </label>
            ))}
          </div>

          {mode === "adversarial" && (
            <div className="mode-warning">
              <span>!</span>
              <p>
                <strong>No secret witness.</strong> The engine builds a forgery
                around one predicted challenge and tests it against the
                verifier.
              </p>
            </div>
          )}
          {error && <div className="form-error">{error}</div>}

          <button
            type="button"
            className="execute-button"
            onClick={execute}
            disabled={computing}
          >
            <span>
              {computing
                ? "Computing…"
                : run
                  ? "Run new proof"
                  : "Start protocol"}
            </span>
            <b>→</b>
          </button>
        </aside>

        <section className="visualizer">
          <div className="visualizer-toolbar">
            <div>
              <p>LIVE PROTOCOL DIAGRAM</p>
              <h2>{run ? run.claim : "Commitment → challenge → response"}</h2>
            </div>
            {run && (
              <div className="playback">
                <button
                  type="button"
                  onClick={() => setActiveStep(Math.max(0, activeStep - 1))}
                  disabled={activeStep === 0}
                  aria-label="Previous step"
                >
                  ←
                </button>
                <button
                  type="button"
                  className="play-button"
                  onClick={() => {
                    if (activeStep === run.steps.length - 1) setActiveStep(0)
                    setPlaying((current) => !current)
                  }}
                >
                  {playing ? "Pause" : "Play"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setActiveStep(
                      Math.min(run.steps.length - 1, activeStep + 1),
                    )
                  }
                  disabled={activeStep === run.steps.length - 1}
                  aria-label="Next step"
                >
                  →
                </button>
                <span>
                  {String(activeStep + 1).padStart(2, "0")} /{" "}
                  {String(run.steps.length).padStart(2, "0")}
                </span>
              </div>
            )}
          </div>

          <div className="actor-header">
            <div className="actor prover">
              <span>
                <ActorIcon />
              </span>
              <div>
                <strong>
                  {mode === "adversarial" ? "Fraud Prover" : "Prover"}
                </strong>
                <small>
                  {mode === "adversarial"
                    ? "Does not know the witness"
                    : "Knows the private witness"}
                </small>
              </div>
            </div>
            <div className="channel-label">
              <span /> PUBLIC CHANNEL <span />
            </div>
            <div className="actor verifier">
              <div>
                <strong>Verifier</strong>
                <small>Checks without learning the secret</small>
              </div>
              <span>
                <ActorIcon verifier />
              </span>
            </div>
          </div>

          <div className="sequence-window">
            {!run ? (
              <div className="empty-diagram">
                <div className="empty-actors">
                  <span>
                    <ActorIcon />
                  </span>
                  <div className="empty-channel">
                    <i />
                    <b>commit</b>
                    <i />
                    <b>challenge</b>
                    <i />
                    <b>response</b>
                    <i />
                  </div>
                  <span>
                    <ActorIcon verifier />
                  </span>
                </div>
                <h3>The protocol will unfold here.</h3>
                <p>
                  Start a run to follow every private computation, public
                  message, random challenge, and verification equation in order.
                </p>
              </div>
            ) : (
              <div className="sequence">
                {visibleSteps.map((step, index) => {
                  const active = index === activeStep
                  const revealed = index <= activeStep
                  const side =
                    step.direction === "local-verifier"
                      ? "right"
                      : step.direction === "local-prover"
                        ? "left"
                        : ""
                  return (
                    <button
                      type="button"
                      className={`sequence-row ${step.direction} ${side} ${
                        active ? "active" : ""
                      } ${
                        revealed ? "revealed" : "future"
                      } ${step.status ?? ""}`}
                      key={`${step.phase}-${index}`}
                      data-step={index}
                      onClick={() => {
                        setActiveStep(index)
                        setPlaying(false)
                      }}
                    >
                      <div className="step-number">
                        {String(index + 1).padStart(2, "0")}
                      </div>
                      <div className="step-left">
                        {(step.direction === "local-prover" ||
                          step.direction === "to-verifier") && (
                          <div className="step-card">
                            <p>{step.phase}</p>
                            <strong>{step.title}</strong>
                            {step.direction === "local-prover" && (
                              <MathBlock step={step} />
                            )}
                          </div>
                        )}
                      </div>
                      <div className="exchange">
                        <ExchangeVisual
                          direction={step.direction}
                          active={active}
                          status={step.status}
                        />
                        {(step.direction === "to-verifier" ||
                          step.direction === "to-prover") && (
                          <code>{step.formula}</code>
                        )}
                        {step.direction === "result" && (
                          <div>
                            <strong>{step.title}</strong>
                            <code>{step.formula}</code>
                          </div>
                        )}
                      </div>
                      <div className="step-right">
                        {(step.direction === "local-verifier" ||
                          step.direction === "to-prover") && (
                          <div className="step-card">
                            <p>{step.phase}</p>
                            <strong>{step.title}</strong>
                            {step.direction === "local-verifier" && (
                              <MathBlock step={step} />
                            )}
                          </div>
                        )}
                      </div>
                      <div className="step-explanation">
                        <p>{step.explanation}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {run && (
            <div className={`run-summary ${run.accepted ? "pass" : "fail"}`}>
              <div>
                <span>{run.accepted ? "✓" : "×"}</span>
                <div>
                  <small>FINAL STATE</small>
                  <strong>{run.steps.at(-1)?.title}</strong>
                </div>
              </div>
              <div>
                <small>FORGERY PROBABILITY</small>
                <strong>{run.probability}</strong>
              </div>
              <div className="step-dots">
                {run.steps.map((_, index) => (
                  <button
                    type="button"
                    aria-label={`Go to step ${index + 1}`}
                    key={index}
                    className={
                      index === activeStep
                        ? "active"
                        : index < activeStep
                          ? "done"
                          : ""
                    }
                    onClick={() => {
                      setActiveStep(index)
                      setPlaying(false)
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      <footer>
        <span>ZERO-KNOWLEDGE PROOF ENGINE</span>
        <span>Educational simulator · not production cryptography</span>
      </footer>
    </main>
  )
}
