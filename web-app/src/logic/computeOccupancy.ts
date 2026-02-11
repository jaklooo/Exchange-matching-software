import type { InstituteCapacity, StudentApplication, OccupancyStats } from '../types';

export const DEFAULT_CAPACITY_COLUMNS = {
    "Institute": "Institute", // Not used in calculation but usually present
    "Country": "Country",
    "ID code": "ID code",
    "University Name": "University Name",
    "Erasmus Code": "Erasmus Code",
    "Study language (TBC)": "Study language (TBC)",
    "BC": "BC",
    "MGR": "MGR",
    "PHD": "PHD",
    "ALL": "ALL",
    "IN BC": "IN BC",
    "IN MGR": "IN MGR",
    "IN PHD": "IN PHD",
    "IN ALL": "IN ALL",
    "Specifics": "Specifics",
};

export const DEFAULT_APPLICATION_COLUMNS = {
    "Zdroj.Název": "Zdroj.Název",
    "Domácí katedra": "Domácí katedra",
    "Číslo UK": "Číslo UK",
    "Číslo přihlášky": "Číslo přihlášky",
    "First Name(s)": "First Name(s)",
    "Last Name(s)": "Last Name(s)",
    "E-mail": "E-mail",
    "Studying for degree": "Studying for degree",
    "NOMINOVÁN": "NOMINOVÁN",
    "Priorita": "Priorita",
    "ID code": "ID code",
};

export const normalizeDegree = (value: any): string => {
    if (!value) return "ALL"; // Default fallback? Or maybe ""
    const s = String(value).toUpperCase().trim();
    if (["BC", "BACHELOR", "UNDERGRADUATE"].some(x => s.includes(x))) return "BC";
    if (["MGR", "MASTER", "GRADUATE"].some(x => s.includes(x))) return "MGR";
    if (["PHD", "DOCTORAL", "DOCTOR", "DR"].some(x => s.includes(x))) return "PHD";
    return "ALL"; // Fallback for unknown or "ALL"
};

export const computeOccupancy = (
    capacitiesRaw: any[],
    applicationsRaw: any[],
    capMap: Record<string, string>,
    appMap: Record<string, string>
): {
    adjustedCapacities: InstituteCapacity[],
    stats: OccupancyStats,
    parsedApplications: StudentApplication[]
} => {

    // 1. Parse Capacities
    const capacities: InstituteCapacity[] = capacitiesRaw.map(row => {
        return {
            instituteCode: String(row[capMap["ID code"]] || "").trim(),
            bc: parseInt(row[capMap["BC"]] || "0", 10),
            mgr: parseInt(row[capMap["MGR"]] || "0", 10),
            phd: parseInt(row[capMap["PHD"]] || "0", 10),
            all: parseInt(row[capMap["ALL"]] || "0", 10),
            originalRow: row
        };
    }).filter(c => c.instituteCode); // Filter out empty rows

    // 2. Parse Applications
    const applications: StudentApplication[] = applicationsRaw.map((row, index) => {
        return {
            id: `row-${index}`,
            sourceName: row[appMap["Zdroj.Název"]],
            homeDepartment: row[appMap["Domácí katedra"]],
            ukId: String(row[appMap["Číslo UK"]] || "").trim(),
            appId: row[appMap["Číslo přihlášky"]],
            firstName: row[appMap["First Name(s)"]],
            lastName: row[appMap["Last Name(s)"]],
            email: row[appMap["E-mail"]],
            targetInstituteId: String(row[appMap["ID code"]] || "").trim(),
            studyLevel: normalizeDegree(row[appMap["Studying for degree"]]),
            nominated: String(row[appMap["NOMINOVÁN"]]).toUpperCase().trim() === "ANO",
            priority: parseInt(row[appMap["Priorita"]] || "999", 10), // Default low priority
            rank: 0, // Will be calculated later
            originalData: row
        };
    });

    // 3. Compute Occupancy
    const occupied: Record<string, { bc: number; mgr: number; phd: number; all: number }> = {};

    // Initialize occupied counts for all known institutes
    capacities.forEach(c => {
        occupied[c.instituteCode] = { bc: 0, mgr: 0, phd: 0, all: 0 };
    });

    applications.forEach(app => {
        if (!app.nominated) return;
        if (!app.targetInstituteId) return;

        if (!occupied[app.targetInstituteId]) {
            // Institute in application but not in capacities? Track it anyway or ignore?
            // For safety, initialize it.
            occupied[app.targetInstituteId] = { bc: 0, mgr: 0, phd: 0, all: 0 };
        }

        const stats = occupied[app.targetInstituteId];
        if (app.studyLevel === "BC") stats.bc++;
        else if (app.studyLevel === "MGR") stats.mgr++;
        else if (app.studyLevel === "PHD") stats.phd++;

        // Everyone counts towards ALL (or checks against ALL capacity? Python script implies specific logic)
        // Python logic: 
        // occupancy['ALL'] += 1 (regardless of degree)
        // AND 
        // occupancy[degree] += 1
        stats.all++;
    });

    // 4. Adjust Capacities (Subtract occupied from capacity)
    // Python script logic:
    // row[col] = max(0, row[col] - occupancy[inst_code].get(degree, 0))

    const adjustedCapacities = capacities.map(cap => {
        const occ = occupied[cap.instituteCode] || { bc: 0, mgr: 0, phd: 0, all: 0 };

        const newCap = { ...cap };
        // Subtract occupied slots from capacity
        newCap.bc = Math.max(0, cap.bc - occ.bc);
        newCap.mgr = Math.max(0, cap.mgr - occ.mgr);
        newCap.phd = Math.max(0, cap.phd - occ.phd);
        newCap.all = Math.max(0, cap.all - occ.all);

        // Also update the original row data if we want to export it later
        // But for now, returning the structured object is cleaner.
        return newCap;
    });

    return {
        adjustedCapacities,
        stats: { capacities, occupied },
        parsedApplications: applications
    };
};
