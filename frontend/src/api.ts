export type Protocol = "qr" | "schnorr" | "fiat-shamir"

export type ProofRequest = {
  protocol: Protocol
  cheat: boolean
  form: Record<string, string>
}

export type ProofResponse = {
  transcript: string
}

export async function executePythonProof(
  request: ProofRequest,
): Promise<ProofResponse> {
  const response = await fetch("/api/proof", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.detail ?? "The Python proof engine failed.")
  }

  return data as ProofResponse
}