"""
smoke_test.py — Smoke tests para ArmaHub
Ejecutar: python smoke_test.py
Pide email/contraseña al ejecutar (no queda guardado).
"""
import sys
import time
import getpass

try:
    import requests
except ImportError:
    print("ERROR: Falta 'requests'. Instala con:")
    print("  pip install requests")
    sys.exit(1)

BASE = "https://armahub-backend.onrender.com"
PASS = 0
FAIL = 0
RESULTS = []


def test(method, path, expect_status, label=None, token=None, json_body=None,
         check_json=None, alt_token=None):
    """Ejecuta un request y compara status code."""
    global PASS, FAIL
    url = BASE + path
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if alt_token:
        headers["Authorization"] = f"Bearer {alt_token}"

    tag = label or f"{method.upper()} {path}"
    try:
        t0 = time.time()
        resp = requests.request(method, url, headers=headers, json=json_body, timeout=30)
        ms = int((time.time() - t0) * 1000)
        ok = resp.status_code == expect_status
        extra = ""
        if ok and check_json:
            try:
                data = resp.json()
                for key in check_json:
                    if key not in data:
                        ok = False
                        extra = f" (falta key '{key}' en JSON)"
                        break
            except Exception:
                ok = False
                extra = " (JSON parse error)"

        if ok:
            PASS += 1
            icon = "OK"
            RESULTS.append(("OK", tag, resp.status_code, ms, ""))
        else:
            FAIL += 1
            icon = "FAIL"
            detail = f"esperado {expect_status}, recibido {resp.status_code}{extra}"
            RESULTS.append(("FAIL", tag, resp.status_code, ms, detail))
    except requests.exceptions.Timeout:
        FAIL += 1
        RESULTS.append(("FAIL", tag, 0, 0, "TIMEOUT (>30s)"))
    except Exception as e:
        FAIL += 1
        RESULTS.append(("FAIL", tag, 0, 0, str(e)[:80]))


def login(email, password):
    """Login y devuelve token JWT."""
    resp = requests.post(f"{BASE}/auth/login", params={"email": email, "password": password}, timeout=30)
    if resp.status_code != 200:
        return None, None
    data = resp.json()
    return data.get("access_token"), data.get("role")


def print_results():
    print()
    print("=" * 70)
    print("  RESULTADO SMOKE TEST — ArmaHub")
    print("=" * 70)
    print()
    for status, tag, code, ms, detail in RESULTS:
        icon = "[OK]  " if status == "OK" else "[FAIL]"
        line = f"  {icon} {tag:<50s} {code} ({ms}ms)"
        if detail:
            line += f"\n         -> {detail}"
        print(line)
    print()
    print("-" * 70)
    total = PASS + FAIL
    print(f"  TOTAL: {total} tests  |  {PASS} passed  |  {FAIL} failed")
    if FAIL == 0:
        print("  STATUS: ALL PASSED")
    else:
        print(f"  STATUS: {FAIL} FAILURES")
    print("-" * 70)
    print()


def main():
    print()
    print("=" * 70)
    print("  ArmaHub Smoke Test")
    print(f"  Target: {BASE}")
    print("=" * 70)
    print()

    # Credenciales
    email = input("  Email admin ArmaHub: ").strip()
    password = getpass.getpass("  Password: ").strip()
    if not email or not password:
        print("ERROR: Email y password requeridos.")
        sys.exit(1)

    print()
    print("  Conectando...")
    print()

    # ===================== AUTH =====================
    print("  [1/8] Auth...")
    token_admin, role_admin = login(email, password)
    if not token_admin:
        print("  ERROR: Login fallido. Verifica credenciales.")
        sys.exit(1)
    print(f"         Login OK (rol: {role_admin})")

    test("GET", "/me", 200, "GET /me (con token)", token=token_admin,
         check_json=["email", "role"])
    test("GET", "/me", 401, "GET /me (sin token)")
    test("POST", "/auth/login?email=noexiste@x.com&password=wrong", 401,
         "POST /auth/login (creds malas)")

    # ===================== RECLAMOS =====================
    print("  [2/8] Reclamos...")
    test("GET", "/reclamos", 200, "GET /reclamos (listado)", token=token_admin,
         check_json=["data"])
    test("GET", "/reclamos/mi-resumen", 200, "GET /reclamos/mi-resumen", token=token_admin)
    test("GET", "/reclamos", 401, "GET /reclamos (sin token)")
    test("GET", "/reclamos/presentaciones-stats", 200, "GET /reclamos/presentaciones-stats", token=token_admin)

    # ===================== BARRAS (sistema cerrado) =====================
    print("  [3/8] Barras (sistema cerrado)...")
    test("POST", "/barras/crear", 403, "POST /barras/crear (deshabilitado)", token=token_admin,
         json_body={"id_proyecto": "X", "sector": "X", "piso": "X", "ciclo": "X",
                    "eje": "X", "diam": 1, "largo_total": 1})
    test("POST", "/barras/cambiar-sector", 403, "POST /barras/cambiar-sector (deshabilitado)",
         token=token_admin, json_body={"id_unicos": ["X"], "nuevo_sector": "X"})
    test("GET", "/proyectos", 200, "GET /proyectos (listado)", token=token_admin)

    # ===================== PEDIDOS (solo admin) =====================
    print("  [4/8] Pedidos (solo admin/admin2)...")
    test("GET", "/pedidos", 200, "GET /pedidos (admin)", token=token_admin)
    test("GET", "/pedidos", 401, "GET /pedidos (sin token)")

    # ===================== CALCULISTAS (solo admin) =====================
    print("  [5/8] Calculistas (solo admin/admin2)...")
    test("GET", "/calculistas", 200, "GET /calculistas (admin)", token=token_admin)
    test("GET", "/calculistas", 401, "GET /calculistas (sin token)")

    # ===================== CONSTRUCTORAS (solo admin) =====================
    print("  [6/8] Constructoras (solo admin/admin2)...")
    test("GET", "/constructoras", 200, "GET /constructoras (admin)", token=token_admin)
    test("GET", "/constructoras", 401, "GET /constructoras (sin token)")

    # ===================== ADMIN =====================
    print("  [7/8] Admin...")
    test("GET", "/admin/db-info", 200, "GET /admin/db-info (admin)", token=token_admin)
    test("GET", "/admin/tables", 200, "GET /admin/tables (admin)", token=token_admin)
    test("GET", "/admin/audit", 200, "GET /admin/audit (admin)", token=token_admin)
    test("GET", "/admin/db-info", 401, "GET /admin/db-info (sin token)")

    # ===================== EXPORT =====================
    print("  [8/8] Export y otros...")
    test("GET", "/landing/indicadores", 200, "GET /landing/indicadores", token=token_admin)
    test("GET", "/stats", 200, "GET /stats (dashboard)", token=token_admin)

    # ===================== RESULTADOS =====================
    print_results()


if __name__ == "__main__":
    main()
