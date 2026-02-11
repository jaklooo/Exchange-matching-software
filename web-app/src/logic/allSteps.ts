/**
 * All 6 steps of the nomination workflow, ported from Python (app.py).
 * Works on plain JS arrays of row objects (each row = { colName: value }).
 */

// ─── Column defaults ────────────────────────────────────────────────
export const DEFAULT_CAP_COLS: Record<string, string> = {
    "ID code": "ID code",
    BC: "BC",
    MGR: "MGR",
    PHD: "PHD",
    ALL: "ALL",
};

export const DEFAULT_APP_COLS: Record<string, string> = {
    "Číslo UK": "Číslo UK",
    "ID code": "ID code",
    "Studying for degree": "Studying for degree",
    NOMINOVÁN: "NOMINOVÁN",
    PRIORITA: "PRIORITA",
    "Pořadí": "Pořadí",
};

const DEGREE_MAP: Record<string, string> = {
    BC: "BC", BSC: "BC", BACHELOR: "BC",
    MGR: "MGR", MSC: "MGR", MASTER: "MGR",
    PHD: "PHD", DR: "PHD", DOCTOR: "PHD",
};

function normDegree(v: any): string | null {
    if (!v) return null;
    const s = String(v).toUpperCase().trim();
    return DEGREE_MAP[s] ?? null;
}

function num(v: any): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function str(v: any): string {
    return v == null ? "" : String(v).trim();
}

// ─── Step 1 ─ compute occupancy ─────────────────────────────────────
export function step1_computeOccupancy(
    capRows: any[],
    appRows: any[],
    capC: Record<string, string>,
    appC: Record<string, string>,
) {
    const idC = capC["ID code"];
    const nomCol = appC["NOMINOVÁN"];
    const degCol = appC["Studying for degree"];
    const appId = appC["ID code"];

    // count nominated per institute per degree
    const counts: Record<string, Record<string, number>> = {};
    for (const r of appRows) {
        if (str(r[nomCol]).toUpperCase() !== "ANO") continue;
        const code = str(r[appId]);
        if (!code) continue;
        const deg = normDegree(r[degCol]);
        if (!counts[code]) counts[code] = { BC: 0, MGR: 0, PHD: 0, ALL: 0 };
        counts[code].ALL++;
        if (deg) counts[code][deg] = (counts[code][deg] || 0) + 1;
    }

    // replace capacity numbers with occupancy numbers (as Python does)
    const adjusted = capRows.map(row => {
        const nr: any = { ...row };
        const code = str(row[idC]);
        const occ = counts[code] || { BC: 0, MGR: 0, PHD: 0, ALL: 0 };
        for (const d of ["BC", "MGR", "PHD", "ALL"] as const) {
            if (capC[d]) nr[capC[d]] = occ[d];
        }
        return nr;
    });

    return adjusted;
}

// ─── Step 2 ─ filter duplicates ─────────────────────────────────────
export function step2_filterDuplicates(
    rows: any[],
    appC: Record<string, string>,
) {
    const ukCol = appC["Číslo UK"];
    const nomCol = appC["NOMINOVÁN"];
    const prioCol = appC["PRIORITA"];

    // group by UK
    const groups: Record<string, any[]> = {};
    for (const r of rows) {
        const uk = str(r[ukCol]);
        (groups[uk] ??= []).push(r);
    }

    const result: any[] = [];
    for (const group of Object.values(groups)) {
        const anos = group.filter(r => str(r[nomCol]).toUpperCase() === "ANO");
        if (anos.length === 0) { result.push(...group); continue; }
        const minPrio = Math.min(...anos.map(r => num(r[prioCol])));
        if (!Number.isFinite(minPrio)) { result.push(...group); continue; }
        result.push(...group.filter(r => num(r[prioCol]) <= minPrio));
    }
    return result;
}

// ─── Step 3 ─ renumber ordering ─────────────────────────────────────
export function step3_normalizeOrdering(
    rows: any[],
    appC: Record<string, string>,
) {
    const idCol = appC["ID code"];
    const orderCol = appC["Pořadí"];

    const groups: Record<string, any[]> = {};
    for (const r of rows) { const k = str(r[idCol]); (groups[k] ??= []).push(r); }

    const result: any[] = [];
    for (const group of Object.values(groups)) {
        group.sort((a, b) => num(a[orderCol]) - num(b[orderCol]));
        group.forEach((r, i) => { r[orderCol] = i + 1; });
        result.push(...group);
    }
    return result;
}

// ─── Step 4 ─ build result table (select by capacity) ───────────────
export function step4_buildResultTable(
    rows: any[],
    capRows: any[],
    capC: Record<string, string>,
    appC: Record<string, string>,
) {
    const capIdCol = capC["ID code"];
    const capAllCol = capC["ALL"];
    const idCol = appC["ID code"];
    const orderCol = appC["Pořadí"];

    // capacity map
    const capMap: Record<string, number> = {};
    for (const r of capRows) {
        const code = str(r[capIdCol]);
        capMap[code] = num(r[capAllCol]);
    }

    // group by id_code, sort by order, take top <capacity>
    const groups: Record<string, any[]> = {};
    for (const r of rows) { const k = str(r[idCol]); (groups[k] ??= []).push(r); }

    const selected: any[] = [];
    for (const [code, group] of Object.entries(groups)) {
        const cap = capMap[code] ?? 0;
        if (cap <= 0) continue;
        group.sort((a, b) => num(a[orderCol]) - num(b[orderCol]));
        selected.push(...group.slice(0, cap));
    }
    return selected;
}

// ─── Step 5 ─ update nominations ────────────────────────────────────
export function step5_updateNominations(
    workingRows: any[],
    resultRows: any[],
    appC: Record<string, string>,
) {
    const nomCol = appC["NOMINOVÁN"];
    const ukCol = appC["Číslo UK"];
    const idCol = appC["ID code"];

    // build accepted set
    const accepted = new Set<string>();
    for (const r of resultRows) {
        accepted.add(`${str(r[ukCol])}||${str(r[idCol])}`);
    }

    const updatedWork = workingRows.map(r => {
        const key = `${str(r[ukCol])}||${str(r[idCol])}`;
        return { ...r, [nomCol]: accepted.has(key) ? "ANO" : "NE" };
    });

    const updatedResult = resultRows.map(r => ({ ...r, [nomCol]: "ANO" }));

    return { updatedWork, updatedResult };
}

// ─── Step 6 ─ resolve duplicate cycles ──────────────────────────────
export function step6_resolveCycles(
    rows: any[],
    capRows: any[],
    capC: Record<string, string>,
    appC: Record<string, string>,
) {
    const ukCol = appC["Číslo UK"];
    const nomCol = appC["NOMINOVÁN"];
    const idCol = appC["ID code"];
    const orderCol = appC["Pořadí"];
    const prioCol = appC["PRIORITA"];
    const capIdCol = capC["ID code"];
    const capAllCol = capC["ALL"];

    const df = rows.map(r => ({ ...r })); // shallow clone each row

    // normalise
    df.forEach(r => {
        r[nomCol] = str(r[nomCol]).toUpperCase();
        r[orderCol] = num(r[orderCol]);
        if (prioCol) r[prioCol] = num(r[prioCol]);
    });

    // capacity map
    const capMap: Record<string, number> = {};
    for (const r of capRows) capMap[str(r[capIdCol])] = num(r[capAllCol]);

    // find students with both ANO and NE
    const studentsWithBoth = new Set<string>();
    const byUk: Record<string, any[]> = {};
    for (const r of df) { const k = str(r[ukCol]); (byUk[k] ??= []).push(r); }
    for (const [uk, grp] of Object.entries(byUk)) {
        const hasAno = grp.some(r => r[nomCol] === "ANO");
        const hasNe = grp.some(r => r[nomCol] === "NE");
        if (hasAno && hasNe) studentsWithBoth.add(uk);
    }

    if (studentsWithBoth.size === 0) return df;

    // build edges
    const edges: Record<string, Set<string>> = {};
    for (const uk of studentsWithBoth) {
        edges[uk] = new Set();
        const neRows = (byUk[uk] || []).filter(r => r[nomCol] === "NE");
        for (const ne of neRows) {
            const school = str(ne[idCol]);
            for (const r of df) {
                if (str(r[idCol]) === school && r[nomCol] === "ANO" && str(r[ukCol]) !== uk && studentsWithBoth.has(str(r[ukCol]))) {
                    edges[uk].add(str(r[ukCol]));
                }
            }
        }
    }

    // DFS cycle detection
    function findCycles(): string[][] {
        const cycles: string[][] = [];
        const found = new Set<string>();
        for (const uk of studentsWithBoth) {
            if (found.has(uk)) continue;
            const visited = new Set<string>();
            const path: string[] = [];
            const pathSet = new Set<string>();
            function dfs(cur: string): string[] | null {
                if (pathSet.has(cur)) return path.slice(path.indexOf(cur));
                if (visited.has(cur)) return null;
                visited.add(cur); path.push(cur); pathSet.add(cur);
                for (const next of edges[cur] || []) { const c = dfs(next); if (c) return c; }
                path.pop(); pathSet.delete(cur);
                return null;
            }
            const cycle = dfs(uk);
            if (cycle && cycle.length >= 2) { cycles.push(cycle); cycle.forEach(u => found.add(u)); }
        }
        return cycles;
    }

    function wouldAllGetNom(cycleUks: Set<string>): boolean {
        const testDf = df.filter(r => !(cycleUks.has(str(r[ukCol])) && r[nomCol] === "ANO"));
        for (const uk of cycleUks) {
            const neRows = testDf.filter(r => str(r[ukCol]) === uk);
            if (prioCol) neRows.sort((a, b) => a[prioCol] - b[prioCol]);
            for (const ne of neRows) {
                const school = str(ne[idCol]);
                const order = ne[orderCol];
                const cap = capMap[school] ?? 0;
                const better = testDf.filter(r => str(r[idCol]) === school && r[orderCol] < order).length;
                if (better >= cap) return false;
                break;
            }
        }
        return true;
    }

    const rowsToDelete = new Set<number>();
    const cycles = findCycles();

    for (const cycle of cycles) {
        const uks = new Set(cycle);
        if (wouldAllGetNom(uks)) {
            df.forEach((r, i) => { if (uks.has(str(r[ukCol])) && r[nomCol] === "ANO") rowsToDelete.add(i); });
        } else {
            df.forEach((r, i) => { if (uks.has(str(r[ukCol])) && r[nomCol] === "NE") rowsToDelete.add(i); });
        }
    }

    // handle non-cycle duplicates
    const processedUks = new Set<string>();
    for (const c of cycles) c.forEach(u => processedUks.add(u));

    for (const [uk, grp] of Object.entries(byUk)) {
        if (processedUks.has(uk)) continue;
        const anos = grp.filter(r => r[nomCol] === "ANO");
        const nes = grp.filter(r => r[nomCol] === "NE");
        if (!anos.length || !nes.length) continue;
        for (const ne of nes) {
            const school = str(ne[idCol]);
            const schoolAnos = df.filter(r => str(r[idCol]) === school && r[nomCol] === "ANO" && str(r[ukCol]) !== uk);
            const anyDup = schoolAnos.some(r => (byUk[str(r[ukCol])] || []).length > 1);
            if (!anyDup) {
                const idx = df.indexOf(ne);
                if (idx >= 0) rowsToDelete.add(idx);
            }
        }
    }

    return df.filter((_, i) => !rowsToDelete.has(i));
}
