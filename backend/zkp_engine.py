"""
Zero-Knowledge Proof Engine - protocol logic.

Every protocol function returns a list of text lines (a step-by-step transcript)
that the UI prints in the output box.

  QR           prove you know x with  x^2 = y (mod N)
  Schnorr      prove you know x with  g^x = Y (mod p)
  Fiat-Shamir  Schnorr where the verifier's random challenge is replaced by a hash

Each protocol has an honest prover (knows x) and a cheater (does not know x).
"""
import hashlib
import math
import secrets


# ------------------------------------------------------------------ helpers
def rand_unit(N):
    """Random r in [2, N-1] that is invertible mod N (gcd(r, N) = 1)."""\

    while True:
        r = 2 + secrets.randbelow(N - 2)
        if math.gcd(r, N) == 1:
            return r


def confirm(name, given, expected):
    """If the user typed the public value, it must match what the secret produces."""

    if given is not None and given != expected:
        raise ValueError(f"{name} should be {expected} for this secret, not {given}")


def check_group(p, q, g, x=None):
    """Schnorr needs q | p-1 and g of order q (g^q = 1 mod p, g != 1)."""

    if (p - 1) % q != 0:
        raise ValueError(f"q must divide p-1 (p-1 = {p - 1})")
    if g < 2 or pow(g, q, p) != 1:
        valid = sorted({pow(h, (p - 1) // q, p) for h in range(2, 9)} - {1})
        raise ValueError(f"g must satisfy g^q mod p = 1. Some valid choices: {valid}")
    if x is not None and not 1 <= x < q:
        raise ValueError(f"x must be between 1 and q-1 (q = {q})")


# ------------------------------------------------------------------ QR
def qr_check(N, y, s, b, z):
    """Verifier's test. b=0: z^2 = s*y.  b=1: z^2 = s.  (all mod N)"""

    left = pow(z, 2, N)
    right, name = (s * y % N, "s*y mod N") if b == 0 else (s, "s")
    # s must be invertible, otherwise s = z = 0 would pass every check
    ok = math.gcd(s, N) == 1 and left == right
    return ok, f"z^2 mod N = {left}  vs  {name} = {right} -> {'ACCEPT' if ok else 'REJECT'}"


def qr_honest(N, x, y=None, rounds=3):
    confirm("y", y, pow(x, 2, N))
    y = pow(x, 2, N)
    out = [f"Claim: the prover knows x with x^2 = {y} (mod {N}), without revealing x.", ""]
    for i in range(1, rounds + 1):
        r = rand_unit(N)                    # one-time random mask (fresh every round!)
        s = pow(r, 2, N)                    # commitment: hides r
        b = secrets.randbelow(2)            # verifier's coin, tossed AFTER it sees s
        z = r * x % N if b == 0 else r      # b=0: mask the secret with r. b=1: reveal the mask
        ok, text = qr_check(N, y, s, b, z)
        out += [f"Round {i}",
                f"  Prover   picks r = {r}, commits s = r^2 mod N = {s}",
                f"  Verifier tosses a coin: b = {b}",
                f"  Prover   sends z = " + (f"r*x mod N = {z}" if b == 0 else f"r = {z}"),
                f"  Verifier checks {text}"]
    out += ["", f"All {rounds} rounds accepted. A cheater survives with probability 1/{2 ** rounds}.",
            "Why x stays secret: the verifier sees s and only ONE of z = r*x or z = r. Each alone looks random."]
    return out


def qr_cheat(N, y, z, b_guess, rounds=3):
    """The cheater does not know x. He bets on the verifier's coin, picks z FIRST and works
    backwards to a commitment s that passes the check for that coin only."""

    if math.gcd(z, N) != 1:
        raise ValueError("z must be coprime to N")
    out = [f"Cheater knows only N = {N} and y = {y}, not x.", ""]
    for i in range(1, rounds + 1):
        if i > 1:                           # after the first round he guesses at random
            z, b_guess = rand_unit(N), secrets.randbelow(2)
        if b_guess == 1:
            s = pow(z, 2, N)                            # bet b=1: check is z^2 = s
        else:
            s = pow(z, 2, N) * pow(y, -1, N) % N        # bet b=0: check is z^2 = s*y
        b = secrets.randbelow(2)
        ok, text = qr_check(N, y, s, b, z)
        out += [f"Round {i}",
                f"  Cheater  bets b = {b_guess}, picks z = {z} first, commits s = {s}",
                f"  Verifier tosses a coin: b = {b}",
                f"  Cheater  sends z = {z}",
                f"  Verifier checks {text}"]
        if not ok:
            out += ["  Wrong bet. Answering the other coin needs a square root of y mod N,",
                    "  which is the secret x. Infeasible without factoring N. CAUGHT."]
            break
    else:
        out += ["", f"The cheater guessed every coin (probability 1/{2 ** rounds}). More rounds make that unlikely."]
    return out


# ------------------------------------------------------------------ Schnorr
def schnorr_check(p, g, Y, T, c, z):
    """Verifier's test: g^z = T * Y^c (mod p)."""

    left = pow(g, z, p)
    right = T * pow(Y, c, p) % p
    ok = left == right
    return ok, f"g^z mod p = {left}  vs  T*Y^c mod p = {right} -> {'ACCEPT' if ok else 'REJECT'}"


def schnorr_honest(p, q, g, x, Y=None, rounds=1):
    check_group(p, q, g, x)
    confirm("Y", Y, pow(g, x, p))
    Y = pow(g, x, p)
    out = [f"Claim: the prover knows x with g^x = {Y} (mod {p}), without revealing x.", ""]
    for i in range(1, rounds + 1):
        k = 1 + secrets.randbelow(q - 1)    # one-time secret nonce
        T = pow(g, k, p)                    # commitment
        c = secrets.randbelow(q)            # verifier's random challenge, sent AFTER it sees T
        z = (k + c * x) % q                 # response: the secret blended with the nonce
        ok, text = schnorr_check(p, g, Y, T, c, z)
        out += [f"Round {i}",
                f"  Prover   picks k = {k}, commits T = g^k mod p = {T}",
                f"  Verifier sends challenge c = {c}",
                f"  Prover   sends z = k + c*x mod q = {z}",
                f"  Verifier checks {text}"]
    out += ["", f"Accepted. A cheater survives with probability 1/{q ** rounds}.",
            "Why x stays secret: z = k + c*x is masked by the random nonce k, so z alone looks random."]
    return out


def schnorr_cheat(p, q, g, Y, z, c_guess, rounds=1):
    """The cheater does not know x. He guesses the challenge c, picks z FIRST and
    computes T = g^z * Y^-c, which passes the check for that c only."""
    
    check_group(p, q, g)
    if not (0 <= z < q and 0 <= c_guess < q):
        raise ValueError(f"z and c must be between 0 and q-1 (q = {q})")
    out = [f"Cheater knows only Y = {Y}, not x.", ""]
    for i in range(1, rounds + 1):
        if i > 1:
            z, c_guess = secrets.randbelow(q), secrets.randbelow(q)
        T = pow(g, z, p) * pow(Y, -c_guess, p) % p      # pow(Y, -c, p) = inverse of Y^c
        c = secrets.randbelow(q)
        ok, text = schnorr_check(p, g, Y, T, c, z)
        out += [f"Round {i}",
                f"  Cheater  guesses c = {c_guess}, picks z = {z}, commits T = g^z * Y^-c = {T}",
                f"  Verifier sends challenge c = {c}",
                f"  Cheater  sends z = {z}",
                f"  Verifier checks {text}"]
        if not ok:
            out += ["  Wrong guess. A different c needs k = log_g(T) and x = log_g(Y):",
                    "  discrete logarithms, infeasible for large p. CAUGHT."]
            break
    else:
        out += ["", f"The cheater guessed every challenge (probability 1/{q ** rounds})."]
    return out


# ------------------------------------------------------------------ Fiat-Shamir
def fs_challenge(statement, T, q):
    """The verifier's random challenge becomes a hash of the public statement and the commitment.
    (Real systems also hash the public parameters; omitted here to keep it simple.)"""
    digest = hashlib.sha256(f"{statement}|{T}".encode()).hexdigest()
    return int(digest, 16) % q


def fs_honest(p, q, g, x, statement, Y=None):
    check_group(p, q, g, x)
    confirm("Y", Y, pow(g, x, p))
    Y = pow(g, x, p)
    k = 1 + secrets.randbelow(q - 1)
    T = pow(g, k, p)                                    # commitment
    c = fs_challenge(statement, T, q)                   # no verifier online: the hash is the challenge
    z = (k + c * x) % q
    c_check = fs_challenge(statement, T, q)             # the verifier recomputes c on its own
    ok, text = schnorr_check(p, g, Y, T, c_check, z)
    return [f"Claim: the prover knows x with g^x = {Y} (mod {p}), bound to the statement '{statement}'.", "",
            f"Prover   picks k = {k}, commits T = g^k mod p = {T}",
            f"Prover   challenge c = SHA-256('{statement}|T') mod q = {c}",
            f"Prover   z = k + c*x mod q = {z}.  Proof = (T = {T}, z = {z})",
            f"Verifier recomputes c = {c_check}, then checks {text}", "",
            "No interaction needed. Change the statement and c changes, so the proof no longer verifies."]


def fs_cheat(p, q, g, Y, statement, z, c_guess):
    """The cheater picks z and a target c, builds T = g^z * Y^-c, and hopes the hash of
    (statement, T) equals c. He cannot choose the hash output, so he only wins by luck."""
    check_group(p, q, g)
    if not (0 <= z < q and 0 <= c_guess < q):
        raise ValueError(f"z and c must be between 0 and q-1 (q = {q})")
    T = pow(g, z, p) * pow(Y, -c_guess, p) % p
    c = fs_challenge(statement, T, q)
    ok, text = schnorr_check(p, g, Y, T, c, z)
    return [f"Cheater knows only Y = {Y}, not x.", "",
            f"Cheater  picks z = {z}, guesses c = {c_guess}, computes T = g^z * Y^-c mod p = {T}",
            f"Verifier computes c = SHA-256('{statement}|T') mod q = {c}  (the cheater cannot choose it)",
            f"Verifier checks {text}", "",
            "The hash happened to equal the guess (probability 1/q): forged proof accepted." if ok else
            "The hash differs from the guess, so the proof is rejected. One try succeeds with probability 1/q."]


# ------------------------------------------------------------------ entry point
def run(protocol, cheat, form):
    """Called by the UI. `form` is a dict of the text-box values (strings); returns the text to show."""
    try:
        n = {k: int(v) for k, v in form.items() if k != "statement" and v.strip()}   # blank boxes skipped
        if protocol == "qr":
            rounds = n.get("rounds", 3)
            out = (qr_cheat(n["N"], n["y"], n["z"], n["b_guess"], rounds) if cheat
                   else qr_honest(n["N"], n["x"], n.get("y"), rounds))
        elif protocol == "schnorr":
            rounds = n.get("rounds", 1)
            out = (schnorr_cheat(n["p"], n["q"], n["g"], n["Y"], n["z"], n["c"], rounds) if cheat
                   else schnorr_honest(n["p"], n["q"], n["g"], n["x"], n.get("Y"), rounds))
        else:
            statement = form.get("statement", "").strip()
            if not statement:
                raise ValueError("enter a public statement")
            out = (fs_cheat(n["p"], n["q"], n["g"], n["Y"], statement, n["z"], n["c"]) if cheat
                   else fs_honest(n["p"], n["q"], n["g"], n["x"], statement, n.get("Y")))
        return "\n".join(out)
    except KeyError as e:
        return f"Missing input: {e.args[0]}"
    except ValueError as e:
        return f"Error: {e}"


if __name__ == "__main__":
    toy = {"p": "23", "q": "11", "g": "2"}
    demos = [("qr", False, {"N": "77", "x": "13"}),
             ("qr", True, {"N": "77", "y": "15", "z": "53", "b_guess": "0"}),
             ("schnorr", False, {**toy, "x": "3"}),
             ("schnorr", True, {**toy, "Y": "8", "z": "5", "c": "4"}),
             ("fiat-shamir", False, {**toy, "x": "3", "statement": "QR-AUTH"}),
             ("fiat-shamir", True, {**toy, "Y": "8", "z": "5", "c": "4", "statement": "QR-AUTH"})]
    for protocol, cheat, form in demos:
        print(f"===== {protocol} ({'cheat' if cheat else 'honest'}) =====")
        print(run(protocol, cheat, form), "\n")