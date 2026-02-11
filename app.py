import io
from typing import Dict, Optional, Tuple

import pandas as pd
import streamlit as st


DEFAULT_CAPACITY_COLUMNS = {
    "Institute": "Institute",
    "Country": "Country",
    "ID code": "ID code",
    "University Name": "University Name",
    "Study programme": "Study programme",
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
}

DEFAULT_APPLICATION_COLUMNS = {
    "Zdroj.Název": "Zdroj.Název",
    "Domácí katedra": "Domácí katedra",
    "Číslo UK": "Číslo UK",
    "Číslo přihlášky": "Číslo přihlášky",
    "First Name(s)": "First Name(s)",
    "Family Name(s)": "Family Name(s)",
    "Subject area": "Subject area",
    "Subject area2": "Subject area2",
    "Zahraniční univerzita": "Zahraniční univerzita",
    "ID code": "ID code",
    "Study programme": "Study programme",
    "Study branch": "Study branch",
    "From": "From",
    "To": "To",
    "E-mail": "E-mail",
    "Date of Birth": "Date of Birth",
    "Sex": "Sex",
    "State Citizenship": "State Citizenship",
    "Studying for degree": "Studying for degree",
    "Years of study to date": "Years of study to date",
    "PRŮMĚR": "PRŮMĚR",
    "PRIORITA": "PRIORITA",
    "Pořadí": "Pořadí",
    "NOMINOVÁN": "NOMINOVÁN",
    "POZNÁMKA": "POZNÁMKA",
    "Filtr": "Filtr",
    "Index_Init": "Index_Init",
    "UserID": "UserID",
    "Váha": "Váha",
}

DEGREE_TO_CAPACITY_COL = {
    "BC": "BC",
    "BSc": "BC",
    "BACHELOR": "BC",
    "MGR": "MGR",
    "MSC": "MGR",
    "MASTER": "MGR",
    "PHD": "PHD",
    "DR": "PHD",
    "DOCTOR": "PHD",
}


st.set_page_config(page_title="Nominácie – workflow", layout="wide")

st.title("Nominácie študentov")
st.caption("Kroky 1–4: kontrola kapacít, čistenie pracovného hárku a výber študentov.")

st.markdown(
    "Nahrajte 2 tabuľky: **kapacity inštitútov** (hárok 1) a **prihlášky študentov** "
    "(hárok 3). Program spočíta reálnu obsadenosť pre `BC/MGR/PHD/ALL` iba z riadkov, "
    "kde je `NOMINOVÁN = ANO`."
)

with st.sidebar:
    st.subheader("Postup")
    st.markdown(
        "1. Načítanie a mapovanie stĺpcov\n"
        "2. Krok 1 – úprava kapacít\n"
        "3. Krok 2 – filter duplicít (Číslo UK)\n"
        "4. Krok 3 – prečíslovanie poradia (ID code)\n"
        "5. Krok 4 – výber študentov podľa kapacity"
    )
    st.divider()
    st.subheader("Tipy")
    st.caption("Skontrolujte správny hárok a riadok hlavičky."
               " Ak stĺpce nesedia, upravte mapovanie.")


def read_uploaded_table(file, sheet_name=None, header_row: int = 0) -> pd.DataFrame:
    name = file.name.lower()
    if name.endswith(".csv"):
        return pd.read_csv(file)
    data = io.BytesIO(file.getvalue())
    return pd.read_excel(data, sheet_name=sheet_name, header=header_row)


def get_excel_sheets(file) -> Optional[list]:
    name = file.name.lower()
    if not (name.endswith(".xlsx") or name.endswith(".xls")):
        return None
    data = io.BytesIO(file.getvalue())
    xls = pd.ExcelFile(data)
    return xls.sheet_names


def build_column_mapper(
    columns,
    defaults: Dict[str, str],
    label: str,
    hint: str,
    required_keys: Tuple[str, ...],
) -> Dict[str, str]:
    st.subheader(label)
    st.caption(hint)
    st.markdown(
        "**Povinné polia:** "
        + ", ".join([f"`{key}`" for key in required_keys])
    )
    mapper: Dict[str, str] = {}
    for key in defaults.keys():
        if key in columns:
            mapper[key] = key
        else:
            mapper[key] = st.selectbox(
                f"Mapovať '{key}'",
                options=["<nepoužiť>"] + list(columns),
                index=0,
                key=f"map_{label}_{key}",
            )
    return mapper


def get_col(mapper: Dict[str, str], key: str) -> Optional[str]:
    value = mapper.get(key)
    if not value or value == "<nepoužiť>":
        return None
    return value


def compute_occupancy(
    capacities: pd.DataFrame,
    applications: pd.DataFrame,
    cap_cols: Dict[str, str],
    app_cols: Dict[str, str],
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    id_code_col = get_col(cap_cols, "ID code")
    if not id_code_col:
        raise ValueError("Chýba stĺpec 'ID code' v kapacitách.")

    app_id_code_col = get_col(app_cols, "ID code")
    degree_col = get_col(app_cols, "Studying for degree")
    nominated_col = get_col(app_cols, "NOMINOVÁN")

    if not app_id_code_col or not degree_col or not nominated_col:
        raise ValueError(
            "Chýbajú povinné stĺpce v prihláškach: 'ID code', 'Studying for degree', 'NOMINOVÁN'."
        )

    nominated = applications[applications[nominated_col].astype(str).str.upper() == "ANO"].copy()
    nominated[degree_col] = nominated[degree_col].astype(str).str.strip().str.upper()

    def normalize_degree(value: str) -> Optional[str]:
        return DEGREE_TO_CAPACITY_COL.get(value)

    nominated["_degree_norm"] = nominated[degree_col].map(normalize_degree)

    grouped = (
        nominated.dropna(subset=["_degree_norm"])
        .groupby([app_id_code_col, "_degree_norm"], dropna=False)
        .size()
        .reset_index(name="_count")
    )

    all_grouped = (
        nominated.groupby(app_id_code_col, dropna=False)
        .size()
        .reset_index(name="_count_all")
    )

    result = capacities.copy()

    for degree, col_name in [
        ("BC", "BC"),
        ("MGR", "MGR"),
        ("PHD", "PHD"),
    ]:
        cap_col = get_col(cap_cols, col_name)
        if cap_col:
            counts = grouped[grouped["_degree_norm"] == degree].set_index(app_id_code_col)[
                "_count"
            ]
            result[cap_col] = result[id_code_col].map(counts).fillna(0).astype(int)

    all_col = get_col(cap_cols, "ALL")
    if all_col:
        all_counts = all_grouped.set_index(app_id_code_col)["_count_all"]
        result[all_col] = result[id_code_col].map(all_counts).fillna(0).astype(int)

    return result, nominated


def filter_duplicates_by_priority(
    working_df: pd.DataFrame,
    app_cols: Dict[str, str],
) -> pd.DataFrame:
    uk_col = get_col(app_cols, "Číslo UK")
    nom_col = get_col(app_cols, "NOMINOVÁN")
    prio_col = get_col(app_cols, "PRIORITA")

    if not uk_col or not nom_col or not prio_col:
        raise ValueError(
            "Chýbajú povinné stĺpce pre krok 2: 'Číslo UK', 'NOMINOVÁN', 'PRIORITA'."
        )

    df = working_df.copy()
    df[nom_col] = df[nom_col].astype(str).str.strip().str.upper()
    df[prio_col] = pd.to_numeric(df[prio_col], errors="coerce")

    def filter_group(group: pd.DataFrame) -> pd.DataFrame:
        anos = group[group[nom_col] == "ANO"]
        if anos.empty:
            return group
        min_ano_prio = anos[prio_col].min()
        if pd.isna(min_ano_prio):
            return group
        return group[group[prio_col] <= min_ano_prio]

    filtered = (
        df.groupby(uk_col, dropna=False, group_keys=False)
        .apply(filter_group)
        .reset_index(drop=True)
    )

    return filtered


def normalize_ordering_by_id_code(
    working_df: pd.DataFrame,
    app_cols: Dict[str, str],
) -> pd.DataFrame:
    id_col = get_col(app_cols, "ID code")
    order_col = get_col(app_cols, "Pořadí")

    if not id_col or not order_col:
        raise ValueError("Chýbajú povinné stĺpce pre krok 3: 'ID code', 'Pořadí'.")

    df = working_df.copy()
    df[order_col] = pd.to_numeric(df[order_col], errors="coerce")

    def renumber_group(group: pd.DataFrame) -> pd.DataFrame:
        group = group.sort_values(order_col, na_position="last").copy()
        group[order_col] = range(1, len(group) + 1)
        return group

    normalized = (
        df.groupby(id_col, dropna=False, group_keys=False)
        .apply(renumber_group)
        .reset_index(drop=True)
    )

    return normalized


def build_result_table(
    working_df: pd.DataFrame,
    capacities_df: pd.DataFrame,
    cap_cols: Dict[str, str],
    app_cols: Dict[str, str],
) -> pd.DataFrame:
    cap_id_col = get_col(cap_cols, "ID code")
    cap_all_col = get_col(cap_cols, "ALL")
    cap_bc_col = get_col(cap_cols, "BC")
    cap_mgr_col = get_col(cap_cols, "MGR")
    cap_phd_col = get_col(cap_cols, "PHD")

    if not cap_id_col:
        raise ValueError("Chýba stĺpec 'ID code' v kapacitách.")

    id_col = get_col(app_cols, "ID code")
    order_col = get_col(app_cols, "Pořadí")

    if not id_col or not order_col:
        raise ValueError("Chýbajú povinné stĺpce v pracovnom hárku: 'ID code', 'Pořadí'.")

    capacity_map = capacities_df.set_index(cap_id_col)

    def capacity_for_id(code):
        if cap_all_col and cap_all_col in capacity_map.columns:
            value = capacity_map.loc[code, cap_all_col] if code in capacity_map.index else 0
            return int(pd.to_numeric(value, errors="coerce") or 0)
        total = 0
        for col in [cap_bc_col, cap_mgr_col, cap_phd_col]:
            if col and col in capacity_map.columns and code in capacity_map.index:
                total += int(pd.to_numeric(capacity_map.loc[code, col], errors="coerce") or 0)
        return total

    df = working_df.copy()
    df[order_col] = pd.to_numeric(df[order_col], errors="coerce")

    selected_rows = []
    for code, group in df.groupby(id_col, dropna=False):
        cap = capacity_for_id(code)
        if cap <= 0:
            continue
        group_sorted = group.sort_values(order_col, na_position="last")
        selected_rows.append(group_sorted.head(cap))

    if selected_rows:
        selected = pd.concat(selected_rows, ignore_index=True)
    else:
        selected = df.head(0).copy()

    output_columns = [
        "Institut",
        "Domácí katedra",
        "ID code",
        "Subject area2",
        "Číslo UK",
        "Číslo přihlášky",
        "Studying for degree",
        "NOMINOVÁN",
        "PRIORITA",
        "Pořadí",
        "Status přijetí",
        "Pomocné - důvod přijetí",
        "UserID",
        "Rozřazovací kolo",
    ]

    result = pd.DataFrame(columns=output_columns)
    for col in output_columns:
        src = get_col(app_cols, col)
        if src and src in selected.columns:
            result[col] = selected[src].values
        else:
            result[col] = ""

    return result


def update_nominations(
    working_df: pd.DataFrame,
    result_df: pd.DataFrame,
    app_cols: Dict[str, str],
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    nom_col = get_col(app_cols, "NOMINOVÁN")
    uk_col = get_col(app_cols, "Číslo UK")
    id_col = get_col(app_cols, "ID code")

    if not nom_col or not uk_col or not id_col:
        raise ValueError("Chýbajú povinné stĺpce: 'NOMINOVÁN', 'Číslo UK', 'ID code'.")

    working_updated = working_df.copy()
    result_updated = result_df.copy()

    if uk_col not in result_df.columns or id_col not in result_df.columns:
        raise ValueError(f"Stĺpce '{uk_col}' alebo '{id_col}' sa nenašli vo výslednej tabuľke.")

    # Vytvor množinu prijatých kombinácií (Číslo UK, ID code)
    accepted_pairs = set()
    for _, row in result_df.iterrows():
        uk_val = str(row[uk_col]) if pd.notna(row[uk_col]) else ""
        id_val = str(row[id_col]) if pd.notna(row[id_col]) else ""
        if uk_val and id_val:
            accepted_pairs.add((uk_val, id_val))

    # Aktualizuj NOMINOVÁN len pre konkrétne kombinácie (Číslo UK + ID code)
    if nom_col in working_updated.columns:
        def check_nomination(row):
            uk_val = str(row[uk_col]) if pd.notna(row[uk_col]) else ""
            id_val = str(row[id_col]) if pd.notna(row[id_col]) else ""
            return "ANO" if (uk_val, id_val) in accepted_pairs else "NE"
        
        working_updated[nom_col] = working_updated.apply(check_nomination, axis=1)

    if nom_col in result_updated.columns:
        result_updated[nom_col] = "ANO"

    return working_updated, result_updated


def resolve_duplicate_cycles(
    working_df: pd.DataFrame,
    capacities_df: pd.DataFrame,
    cap_cols: Dict[str, str],
    app_cols: Dict[str, str],
) -> pd.DataFrame:
    """Krok 6: Analýza a riešenie cyklov duplicít.
    
    Príklad cyklu:
    - Žiak A: ŠkolaA (Priorita 1, Poradie 2, NE), ŠkolaB (Priorita 2, Poradie 1, ANO)
    - Žiak B: ŠkolaA (Priorita 2, Poradie 1, ANO), ŠkolaB (Priorita 1, Poradie 2, NE)
    
    Cyklus: A má NE na ŠkoleA → B má ANO na ŠkoleA → B má NE na ŠkoleB → A má ANO na ŠkoleB → späť
    """
    uk_col = get_col(app_cols, "Číslo UK")
    nom_col = get_col(app_cols, "NOMINOVÁN")
    id_col = get_col(app_cols, "ID code")
    order_col = get_col(app_cols, "Pořadí")
    prio_col = get_col(app_cols, "PRIORITA")
    cap_id_col = get_col(cap_cols, "ID code")
    cap_all_col = get_col(cap_cols, "ALL")

    if not uk_col or not nom_col or not id_col or not order_col:
        raise ValueError(
            "Chýbajú povinné stĺpce pre krok 6: 'Číslo UK', 'NOMINOVÁN', 'ID code', 'Pořadí'."
        )

    df = working_df.copy()
    df[nom_col] = df[nom_col].astype(str).str.strip().str.upper()
    df[order_col] = pd.to_numeric(df[order_col], errors="coerce")
    if prio_col:
        df[prio_col] = pd.to_numeric(df[prio_col], errors="coerce")

    capacity_map = capacities_df.set_index(cap_id_col)

    def get_capacity(code):
        if cap_all_col and cap_all_col in capacity_map.columns and code in capacity_map.index:
            return int(pd.to_numeric(capacity_map.loc[code, cap_all_col], errors="coerce") or 0)
        return 0

    def find_cycles():
        """Nájde všetky cykly medzi študentmi."""
        # Vytvor graf: pre každého študenta s duplicitou (ANO + NE)
        # hrana vedie od študenta s NE na škole X k študentovi s ANO na tej istej škole X
        
        # Nájdi študentov s ANO aj NE
        students_with_both = set()
        for uk in df[uk_col].unique():
            uk_rows = df[df[uk_col] == uk]
            has_ano = (uk_rows[nom_col] == "ANO").any()
            has_ne = (uk_rows[nom_col] == "NE").any()
            if has_ano and has_ne:
                students_with_both.add(uk)
        
        if not students_with_both:
            return []
        
        # Vytvor graf prepojení
        # edge: študent_s_NE -> študent_s_ANO (na rovnakej škole)
        edges = {}  # uk -> set of (other_uk, id_code)
        
        for uk in students_with_both:
            uk_rows = df[df[uk_col] == uk]
            ne_rows = uk_rows[uk_rows[nom_col] == "NE"]
            edges[uk] = set()
            
            for _, ne_row in ne_rows.iterrows():
                school = ne_row[id_col]
                # Nájdi iných študentov s ANO na tej istej škole
                school_anos = df[(df[id_col] == school) & (df[nom_col] == "ANO") & (df[uk_col] != uk)]
                for _, ano_row in school_anos.iterrows():
                    other_uk = ano_row[uk_col]
                    if other_uk in students_with_both:
                        edges[uk].add((other_uk, school))
        
        # DFS pre hľadanie cyklov
        def find_cycle_from(start):
            visited = set()
            path = []
            path_set = set()
            
            def dfs(current):
                if current in path_set:
                    # Našli sme cyklus
                    cycle_start = path.index(current)
                    return path[cycle_start:]
                if current in visited:
                    return None
                
                visited.add(current)
                path.append(current)
                path_set.add(current)
                
                for next_uk, school in edges.get(current, []):
                    result = dfs(next_uk)
                    if result:
                        return result
                
                path.pop()
                path_set.remove(current)
                return None
            
            return dfs(start)
        
        cycles = []
        found_in_cycle = set()
        for uk in students_with_both:
            if uk not in found_in_cycle:
                cycle = find_cycle_from(uk)
                if cycle and len(cycle) >= 2:
                    cycles.append(cycle)
                    found_in_cycle.update(cycle)
        
        return cycles

    def would_all_get_nominated(cycle_uks):
        """Test: ak by ANO záznamy zmizli, dostali by sa všetky NE na nomináciu?"""
        test_df = df.copy()
        
        # Odstráň ANO záznamy pre študentov v cykle
        for uk in cycle_uks:
            ano_idx = test_df[(test_df[uk_col] == uk) & (test_df[nom_col] == "ANO")].index
            test_df = test_df.drop(ano_idx)
        
        # Skontroluj či by sa NE záznamy dostali
        for uk in cycle_uks:
            ne_rows = test_df[test_df[uk_col] == uk]
            # Vezmi NE s najnižšou prioritou (najdôležitejšiu školu)
            if prio_col:
                ne_rows = ne_rows.sort_values(prio_col)
            
            for _, ne_row in ne_rows.iterrows():
                school = ne_row[id_col]
                order = ne_row[order_col]
                capacity = get_capacity(school)
                
                # Koľko ľudí má lepšie poradie na tejto škole?
                school_group = test_df[test_df[id_col] == school]
                better_count = (school_group[order_col] < order).sum()
                
                if better_count >= capacity:
                    return False
                break  # Stačí skontrolovať prvú (najvyššia priorita)
        
        return True

    rows_to_delete = set()
    cycles = find_cycles()
    
    for cycle in cycles:
        cycle_uks = set(cycle)
        
        if would_all_get_nominated(cycle_uks):
            # Všetci by sa dostali → zmaž ANO záznamy (prepusti miesta)
            for uk in cycle_uks:
                ano_idx = df[(df[uk_col] == uk) & (df[nom_col] == "ANO")].index
                rows_to_delete.update(ano_idx)
        else:
            # Nie všetci by sa dostali → zmaž NE záznamy (zachovaj status quo)
            for uk in cycle_uks:
                ne_idx = df[(df[uk_col] == uk) & (df[nom_col] == "NE")].index
                rows_to_delete.update(ne_idx)
    
    # Spracuj aj študentov mimo cyklov (možnosť 1 z pôvodného popisu)
    processed_uks = set()
    for cycle in cycles:
        processed_uks.update(cycle)
    
    for uk in df[uk_col].unique():
        if uk in processed_uks:
            continue
        
        uk_rows = df[df[uk_col] == uk]
        ano_rows = uk_rows[uk_rows[nom_col] == "ANO"]
        ne_rows = uk_rows[uk_rows[nom_col] == "NE"]
        
        if ano_rows.empty or ne_rows.empty:
            continue
        
        # Študent má ANO aj NE, ale nie je v cykle
        # Skontroluj či ANO študenti na školách kde má NE majú duplicity
        for _, ne_row in ne_rows.iterrows():
            school = ne_row[id_col]
            school_anos = df[(df[id_col] == school) & (df[nom_col] == "ANO") & (df[uk_col] != uk)]
            
            any_has_duplicate = False
            for _, ano_row in school_anos.iterrows():
                other_uk = ano_row[uk_col]
                if len(df[df[uk_col] == other_uk]) > 1:
                    any_has_duplicate = True
                    break
            
            if not any_has_duplicate:
                # Žiadny ANO na tej škole nemá duplicitu → zmaž NE
                rows_to_delete.add(ne_row.name)

    result = df.drop(index=list(rows_to_delete)).reset_index(drop=True)
    return result


left, right = st.columns(2)

with left:
    cap_file = st.file_uploader(
        "1) Nahraj tabuľku kapacít (Excel alebo CSV)",
        type=["xlsx", "xls", "csv"],
    )

with right:
    app_file = st.file_uploader(
        "2) Nahraj tabuľku prihlášok (Excel alebo CSV)",
        type=["xlsx", "xls", "csv"],
    )

if cap_file and app_file:
    cap_sheets = get_excel_sheets(cap_file)
    app_sheets = get_excel_sheets(app_file)

    cap_sheet = None
    app_sheet = None
    cap_header = 0
    app_header = 0

    st.markdown("## Nastavenie načítania súborov")
    col1, col2 = st.columns(2)
    with col1:
        if cap_sheets:
            cap_sheet = st.selectbox(
                "Kapacity – vyber hárok (musí byť hárok 1)",
                options=cap_sheets,
                index=0,
            )
            cap_header = st.number_input(
                "Kapacity – riadok hlavičky (0 = prvý riadok)",
                min_value=0,
                value=0,
                step=1,
            )
    with col2:
        if app_sheets:
            app_sheet = st.selectbox(
                "Prihlášky – vyber hárok (musí byť hárok 3)",
                options=app_sheets,
                index=min(2, len(app_sheets) - 1),
            )
            app_header = st.number_input(
                "Prihlášky – riadok hlavičky (0 = prvý riadok)",
                min_value=0,
                value=0,
                step=1,
            )

    capacities_df = read_uploaded_table(cap_file, sheet_name=cap_sheet, header_row=cap_header)
    applications_df = read_uploaded_table(app_file, sheet_name=app_sheet, header_row=app_header)

    st.markdown("## Náhľad načítaných tabuliek")
    preview_tab1, preview_tab2 = st.tabs([
        "Kapacity (hárok 1)",
        "Prihlášky (hárok 3)",
    ])
    with preview_tab1:
        st.dataframe(capacities_df, use_container_width=True)
    with preview_tab2:
        st.dataframe(applications_df, use_container_width=True)

    st.markdown("---")
    cap_map = build_column_mapper(
        capacities_df.columns,
        DEFAULT_CAPACITY_COLUMNS,
        "Kapacity – mapovanie stĺpcov",
        "Tu systém hľadá kapacity pre `BC/MGR/PHD/ALL` a identifikátor školy.",
        ("ID code", "BC", "MGR", "PHD", "ALL"),
    )
    app_map = build_column_mapper(
        applications_df.columns,
        DEFAULT_APPLICATION_COLUMNS,
        "Prihlášky – mapovanie stĺpcov",
        "Tu systém hľadá nominácie, stupeň štúdia a ID kód univerzity.",
        ("ID code", "Studying for degree", "NOMINOVÁN"),
    )

    st.markdown("---")

    if "step" not in st.session_state:
        st.session_state.step = 1
        st.session_state.capacities_step1 = None
        st.session_state.working_sheet = None
        st.session_state.result_table = None

    step_container = st.container()

    with step_container:
        if st.session_state.step == 1:
            st.subheader("Krok 1 – Výpočet reálnej obsadenosti")
            run_step = st.button("Spustiť krok 1", type="primary")
        elif st.session_state.step == 2:
            st.subheader("Krok 2 – Filter duplicít v pracovnom hárku")
            run_step = st.button("Spustiť krok 2", type="primary")
        elif st.session_state.step == 3:
            st.subheader("Krok 3 – Prečíslovanie poradia podľa ID code")
            run_step = st.button("Spustiť krok 3", type="primary")
        elif st.session_state.step == 4:
            st.subheader("Krok 4 – Výber študentov podľa kapacity")
            run_step = st.button("Spustiť krok 4", type="primary")
        elif st.session_state.step == 5:
            st.subheader("Krok 5 – Aktualizácia nominácií")
            run_step = st.button("Spustiť krok 5", type="primary")
        else:
            st.subheader("Krok 6 – Riešenie cyklov duplicít")
            run_step = st.button("Spustiť krok 6", type="primary")

    if run_step:
        if st.session_state.step == 1:
            try:
                adjusted_capacities, nominated_rows = compute_occupancy(
                    capacities_df, applications_df, cap_map, app_map
                )
            except ValueError as exc:
                st.error(str(exc))
                st.stop()

            st.session_state.capacities_step1 = adjusted_capacities
            st.session_state.working_sheet = applications_df.copy()
            st.session_state.step = 2

            st.success("Krok 1 hotový. Kapacity boli upravené podľa reálnych nominácií.")
        elif st.session_state.step == 2:
            try:
                st.session_state.working_sheet = filter_duplicates_by_priority(
                    st.session_state.working_sheet,
                    app_map,
                )
            except ValueError as exc:
                st.error(str(exc))
                st.stop()

            st.session_state.step = 3
            st.success(
                "Krok 2 hotový. Duplicity v pracovnom hárku boli odfiltrované podľa priority."
            )
        elif st.session_state.step == 3:
            try:
                st.session_state.working_sheet = normalize_ordering_by_id_code(
                    st.session_state.working_sheet,
                    app_map,
                )
            except ValueError as exc:
                st.error(str(exc))
                st.stop()

            st.session_state.step = 4
            st.success(
                "Krok 3 hotový. Poradie bolo prečíslované pre každé ID code."
            )
        elif st.session_state.step == 4:
            try:
                st.session_state.result_table = build_result_table(
                    st.session_state.working_sheet,
                    st.session_state.capacities_step1,
                    cap_map,
                    app_map,
                )
            except ValueError as exc:
                st.error(str(exc))
                st.stop()

            st.session_state.step = 5
            st.success(
                "Krok 4 hotový. Výsledná tabuľka bola vytvorená podľa kapacít a poradia."
            )
        elif st.session_state.step == 5:
            try:
                (
                    st.session_state.working_sheet,
                    st.session_state.result_table,
                ) = update_nominations(
                    st.session_state.working_sheet,
                    st.session_state.result_table,
                    app_map,
                )
            except ValueError as exc:
                st.error(str(exc))
                st.stop()

            st.session_state.step = 6
            st.success(
                "Krok 5 hotový. Nominácie boli aktualizované podľa prijatých študentov."
            )
        else:
            try:
                st.session_state.working_sheet = resolve_duplicate_cycles(
                    st.session_state.working_sheet,
                    st.session_state.capacities_step1,
                    cap_map,
                    app_map,
                )
            except ValueError as exc:
                st.error(str(exc))
                st.stop()

            st.success(
                "Krok 6 hotový. Cykly duplicít boli vyriešené."
            )

    if st.session_state.capacities_step1 is not None:
        st.markdown("## Výstupy – prehľad hárkov")
        out_tab1, out_tab2, out_tab3, out_tab4, out_tab5 = st.tabs([
            "Hárok 1 – Kapacity (vstup)",
            "Hárok 2 – Kapacity po úprave",
            "Hárok 3 – Prihlášky (vstup)",
            "Hárok 4 – Pracovná tabuľka",
            "Hárok 5 – Výsledná tabuľka",
        ])
        with out_tab1:
            st.dataframe(capacities_df, use_container_width=True)
        with out_tab2:
            st.dataframe(st.session_state.capacities_step1, use_container_width=True)
        with out_tab3:
            st.dataframe(applications_df, use_container_width=True)
        with out_tab4:
            st.dataframe(st.session_state.working_sheet, use_container_width=True)
        with out_tab5:
            if st.session_state.result_table is None:
                st.info("Výstupná tabuľka bude doplnená v ďalších krokoch analýzy.")
            else:
                st.dataframe(st.session_state.result_table, use_container_width=True)
else:
    st.info("Nahrajte obe tabuľky, aby bolo možné spustiť krok 1.")
