export interface InstituteCapacity {
    instituteCode: string; // 'ID code'
    bc: number;
    mgr: number;
    phd: number;
    all: number;
    // Raw additional data if needed
    [key: string]: any;
}

export interface StudentApplication {
    id: string; // Unique ID (e.g. generated or from row index)
    sourceName: string; // 'Zdroj.Název'
    homeDepartment: string; // 'Domácí katedra'
    ukId: string; // 'Číslo UK'
    appId: string; // 'Číslo přihlášky'
    firstName: string; // 'First Name(s)'
    lastName: string; // 'Last Name(s)'
    email: string; // 'E-mail'

    // The target institute/university details
    targetInstituteId: string; // 'ID code' (from application)

    studyLevel: string; // 'Studying for degree' -> Normalizovaný na BC/MGR/PHD

    nominated: boolean; // 'NOMINOVÁN' == 'ANO'

    priority: number; // 'Priorita'
    rank: number; // 'Poradí' (vypočítané)

    // Original raw row data
    originalData: any;
}

export interface ColumnMap {
    [internalKey: string]: string; // internalKey -> excelColumnHeader
}

export interface OccupancyStats {
    capacities: InstituteCapacity[];
    // Map of instituteID -> { bc: number, mgr: number, phd: number, all: number } (Occupied)
    occupied: Record<string, { bc: number; mgr: number; phd: number; all: number }>;
}
