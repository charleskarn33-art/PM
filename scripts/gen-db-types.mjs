#!/usr/bin/env node
/**
 * Generates Supabase-compatible TypeScript types (`Database`) for the `public`
 * schema by introspecting a PostgreSQL database that has the migrations applied.
 *
 * Equivalent in shape to `supabase gen types typescript`, but needs no Docker.
 *
 *   node scripts/gen-db-types.mjs [--db-url postgres://...] [--out path] [--check]
 *
 * --check exits non-zero if the output file is out of date.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dbUrl =
  arg('--db-url') ?? process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/ipt_pm_test';
const outPath = arg('--out') ?? join(root, 'packages/shared/src/database.types.ts');
const check = args.includes('--check');

export async function generate(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const enums = (
      await client.query(`
        select t.typname as name, array_agg(e.enumlabel::text order by e.enumsortorder) as values
          from pg_type t
          join pg_enum e on e.enumtypid = t.oid
          join pg_namespace n on n.oid = t.typnamespace
         where n.nspname = 'public'
         group by t.typname order by t.typname`)
    ).rows;
    const enumNames = new Set(enums.map((e) => e.name));

    const columns = (
      await client.query(`
        select c.relname as table, c.relkind as kind, a.attname as column, a.attnum,
               not a.attnotnull as nullable,
               a.atthasdef or a.attidentity <> '' as has_default,
               a.attgenerated <> '' as generated,
               a.attidentity = 'a' as identity_always,
               t.typname as type, t.typcategory as category,
               et.typname as elem_type
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
          join pg_type t on t.oid = a.atttypid
          left join pg_type et on et.oid = t.typelem and t.typcategory = 'A'
         where n.nspname = 'public' and c.relkind in ('r', 'v', 'm')
         order by c.relname, a.attnum`)
    ).rows;

    const fks = (
      await client.query(`
        select con.conname as name, c.relname as table, rc.relname as ref_table,
               array(select a.attname::text from unnest(con.conkey) with ordinality k(n, o)
                       join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n order by k.o) as columns,
               array(select a.attname::text from unnest(con.confkey) with ordinality k(n, o)
                       join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n order by k.o) as ref_columns,
               exists (select 1 from pg_index i where i.indrelid = con.conrelid and i.indisunique
                         and i.indpred is null
                         and (i.indkey::int2[])::int[] @> con.conkey::int[]
                         and (i.indkey::int2[])::int[] <@ con.conkey::int[]) as one_to_one
          from pg_constraint con
          join pg_class c on c.oid = con.conrelid
          join pg_class rc on rc.oid = con.confrelid
          join pg_namespace n on n.oid = c.relnamespace
          join pg_namespace rn on rn.oid = rc.relnamespace
         where con.contype = 'f' and n.nspname = 'public' and rn.nspname = 'public'
         order by c.relname, con.conname`)
    ).rows;

    const functions = (
      await client.query(`
        select p.proname as name,
               coalesce(p.proargnames, array[]::text[])::text[] as arg_names,
               array(select format_type(t, null) from unnest(p.proargtypes) t) as arg_types,
               p.pronargdefaults as n_defaults,
               coalesce(p.proargmodes::text[], array[]::text[]) as arg_modes,
               array(select format_type(t, null) from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) t) as all_arg_types,
               format_type(p.prorettype, null) as return_type,
               p.proretset as returns_set,
               rt.typname as return_typname, rt.typtype as return_typtype
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          join pg_type rt on rt.oid = p.prorettype
         where n.nspname = 'public' and p.prokind = 'f'
           and rt.typname <> 'trigger'
         order by p.proname`)
    ).rows;

    const tableNames = new Set(columns.filter((c) => c.kind === 'r').map((c) => c.table));
    return render({ enums, enumNames, columns, fks, functions, tableNames });
  } finally {
    await client.end();
  }
}

function scalar(typname, enumNames) {
  if (enumNames.has(typname)) return `Database['public']['Enums']['${typname}']`;
  switch (typname) {
    case 'int2': case 'int4': case 'int8': case 'float4': case 'float8': case 'numeric':
      return 'number';
    case 'bool':
      return 'boolean';
    case 'json': case 'jsonb':
      return 'Json';
    case 'void':
      return 'undefined';
    default:
      return 'string';
  }
}

function tsType(col, enumNames) {
  const base = col.category === 'A' ? `${scalar(col.elem_type, enumNames)}[]` : scalar(col.type, enumNames);
  return col.nullable ? `${base} | null` : base;
}

function formatTypeToTs(formatted, enumNames) {
  const isArray = formatted.endsWith('[]');
  const bare = formatted.replace(/\[\]$/, '').replace(/^public\./, '');
  const map = {
    uuid: 'uuid', text: 'text', boolean: 'bool', integer: 'int4', bigint: 'int8', smallint: 'int2',
    numeric: 'numeric', jsonb: 'jsonb', json: 'json', void: 'void', 'double precision': 'float8',
    'timestamp with time zone': 'timestamptz', date: 'date',
  };
  const t = scalar(map[bare] ?? bare, enumNames);
  return isArray ? `${t}[]` : t;
}

function render({ enums, enumNames, columns, fks, functions, tableNames }) {
  const byRel = new Map();
  for (const c of columns) {
    if (!byRel.has(c.table)) byRel.set(c.table, { kind: c.kind, cols: [] });
    byRel.get(c.table).cols.push(c);
  }
  const ind = (n) => '  '.repeat(n);
  const out = [];
  out.push('// AUTO-GENERATED by scripts/gen-db-types.mjs from the Supabase migrations.');
  out.push('// Do not edit by hand. Regenerate with: pnpm db:types');
  out.push('');
  out.push('export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];');
  out.push('');
  out.push('export type Database = {');
  out.push(`${ind(1)}public: {`);

  const renderRel = (name, rel, isTable) => {
    out.push(`${ind(3)}${name}: {`);
    out.push(`${ind(4)}Row: {`);
    for (const c of rel.cols) out.push(`${ind(5)}${c.column}: ${tsType(c, enumNames)};`);
    out.push(`${ind(4)}};`);
    if (isTable) {
      out.push(`${ind(4)}Insert: {`);
      for (const c of rel.cols) {
        if (c.generated || c.identity_always) out.push(`${ind(5)}${c.column}?: never;`);
        else {
          const opt = c.nullable || c.has_default ? '?' : '';
          out.push(`${ind(5)}${c.column}${opt}: ${tsType(c, enumNames)};`);
        }
      }
      out.push(`${ind(4)}};`);
      out.push(`${ind(4)}Update: {`);
      for (const c of rel.cols) {
        if (c.generated || c.identity_always) out.push(`${ind(5)}${c.column}?: never;`);
        else out.push(`${ind(5)}${c.column}?: ${tsType(c, enumNames)};`);
      }
      out.push(`${ind(4)}};`);
    }
    const rels = fks.filter((f) => f.table === name);
    if (rels.length === 0) out.push(`${ind(4)}Relationships: [];`);
    else {
      out.push(`${ind(4)}Relationships: [`);
      for (const f of rels) {
        out.push(`${ind(5)}{`);
        out.push(`${ind(6)}foreignKeyName: '${f.name}';`);
        out.push(`${ind(6)}columns: [${f.columns.map((x) => `'${x}'`).join(', ')}];`);
        out.push(`${ind(6)}isOneToOne: ${f.one_to_one};`);
        out.push(`${ind(6)}referencedRelation: '${f.ref_table}';`);
        out.push(`${ind(6)}referencedColumns: [${f.ref_columns.map((x) => `'${x}'`).join(', ')}];`);
        out.push(`${ind(5)}},`);
      }
      out.push(`${ind(4)}];`);
    }
    out.push(`${ind(3)}};`);
  };

  out.push(`${ind(2)}Tables: {`);
  for (const [name, rel] of byRel) if (rel.kind === 'r') renderRel(name, rel, true);
  out.push(`${ind(2)}};`);

  const views = [...byRel].filter(([, r]) => r.kind !== 'r');
  if (views.length === 0) out.push(`${ind(2)}Views: { [_ in never]: never };`);
  else {
    out.push(`${ind(2)}Views: {`);
    for (const [name, rel] of views) renderRel(name, rel, false);
    out.push(`${ind(2)}};`);
  }

  if (functions.length === 0) out.push(`${ind(2)}Functions: { [_ in never]: never };`);
  else {
    out.push(`${ind(2)}Functions: {`);
    for (const f of functions) {
      out.push(`${ind(3)}${f.name}: {`);
      // proargnames covers all arguments (incl. RETURNS TABLE columns, mode 't');
      // proargtypes covers input arguments only.
      const allNames = f.arg_names;
      const inputNames = f.arg_modes.length > 0
        ? f.arg_modes.flatMap((m, i) => (['i', 'b', 'v'].includes(m) ? [allNames[i]] : []))
        : allNames;
      const firstDefault = f.arg_types.length - f.n_defaults;
      if (f.arg_types.length === 0) out.push(`${ind(4)}Args: never;`);
      else {
        out.push(`${ind(4)}Args: {`);
        f.arg_types.forEach((t, i) => {
          const opt = i >= firstDefault ? '?' : '';
          out.push(`${ind(5)}${inputNames[i]}${opt}: ${formatTypeToTs(t, enumNames)};`);
        });
        out.push(`${ind(4)}};`);
      }
      let ret;
      const tableCols = f.arg_modes.flatMap((mode, i) => (mode === 't' ? [i] : []));
      if (tableCols.length > 0) {
        // RETURNS TABLE (...): one object per row.
        ret = `{ ${tableCols.map((i) => `${allNames[i]}: ${formatTypeToTs(f.all_arg_types[i], enumNames)}`).join('; ')} }`;
      } else if (f.return_typtype === 'c' && tableNames.has(f.return_typname)) {
        ret = `Database['public']['Tables']['${f.return_typname}']['Row']`;
      } else ret = formatTypeToTs(f.return_type, enumNames);
      out.push(`${ind(4)}Returns: ${ret}${f.returns_set ? '[]' : ''};`);
      out.push(`${ind(3)}};`);
    }
    out.push(`${ind(2)}};`);
  }

  out.push(`${ind(2)}Enums: {`);
  for (const e of enums) out.push(`${ind(3)}${e.name}: ${e.values.map((v) => `'${v}'`).join(' | ')};`);
  out.push(`${ind(2)}};`);
  out.push(`${ind(2)}CompositeTypes: { [_ in never]: never };`);
  out.push(`${ind(1)}};`);
  out.push('};');
  out.push('');
  out.push("type PublicSchema = Database['public'];");
  out.push("type PublicTablesAndViews = PublicSchema['Tables'] & PublicSchema['Views'];");
  out.push('/** Row type of a table or view. */');
  out.push('export type Tables<T extends keyof PublicTablesAndViews> = PublicTablesAndViews[T][\'Row\'];');
  out.push("export type TablesInsert<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Insert'];");
  out.push("export type TablesUpdate<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Update'];");
  out.push("export type Enums<T extends keyof PublicSchema['Enums']> = PublicSchema['Enums'][T];");
  out.push('');
  out.push('export const Constants = {');
  out.push(`${ind(1)}public: {`);
  out.push(`${ind(2)}Enums: {`);
  for (const e of enums) out.push(`${ind(3)}${e.name}: [${e.values.map((v) => `'${v}'`).join(', ')}],`);
  out.push(`${ind(2)}},`);
  out.push(`${ind(1)}},`);
  out.push('} as const;');
  out.push('');
  return out.join('\n');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const generated = await generate(dbUrl);
  if (check) {
    let current = '';
    try {
      current = readFileSync(outPath, 'utf8');
    } catch {
      /* missing file counts as stale */
    }
    if (current !== generated) {
      console.error(`${outPath} is out of date. Run: pnpm db:types`);
      process.exit(1);
    }
    console.log('Database types are up to date.');
  } else {
    writeFileSync(outPath, generated);
    console.log(`Wrote ${outPath}`);
  }
}
