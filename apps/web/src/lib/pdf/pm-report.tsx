import 'server-only';
import { dcHighLoad, dcPowerKw, humanizeStatus, isFailure, totalPhaseCurrentA, visitProgress, type Tables } from '@ipt/shared';
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { PmReportData } from './pm-report-data';
import { formatDateTime, formatNumber, printable } from './report-format';

const C = { navy: '#0b1f3a', red: '#d71920', text: '#1f2937', muted: '#5b6b82', border: '#d8dee8', soft: '#f4f6fa', danger: '#b91c1c', success: '#15803d' };

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 48, paddingHorizontal: 36, fontSize: 9, fontFamily: 'Helvetica', color: C.text },
  header: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 2, borderBottomColor: C.navy, paddingBottom: 8, marginBottom: 10 },
  brand: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: C.navy },
  brandSub: { fontSize: 8, color: C.muted },
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: C.navy, textAlign: 'right' },
  demo: { marginBottom: 8, padding: 6, backgroundColor: '#fef3c7', color: '#92400e', fontFamily: 'Helvetica-Bold', textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, borderColor: C.border, marginBottom: 10 },
  cell: { width: '25%', padding: 5, borderRightWidth: 1, borderBottomWidth: 1, borderColor: C.border },
  label: { fontSize: 7, color: C.muted, textTransform: 'uppercase', marginBottom: 2 },
  value: { fontSize: 9, fontFamily: 'Helvetica-Bold' },
  h2: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.navy, backgroundColor: C.soft, padding: 5, marginTop: 8, marginBottom: 4 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: C.border, paddingVertical: 3 },
  rowFail: { backgroundColor: '#fee2e2' },
  prompt: { flex: 1, paddingRight: 6 },
  answer: { width: 110, textAlign: 'right', fontFamily: 'Helvetica-Bold' },
  comment: { color: C.muted, fontSize: 8, marginTop: 1 },
  readings: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
  reading: { width: '33.33%', paddingVertical: 2, paddingRight: 6 },
  note: { fontSize: 8, color: C.muted, marginTop: 2 },
  photos: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  photo: { width: 124, marginRight: 6, marginBottom: 6 },
  img: { width: 124, height: 93, objectFit: 'cover', borderWidth: 0.5, borderColor: C.border },
  sign: { flexDirection: 'row', marginTop: 24 },
  signBox: { flex: 1, marginRight: 16, borderTopWidth: 1, borderTopColor: C.text, paddingTop: 4 },
  footer: { position: 'absolute', bottom: 20, left: 36, right: 36, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: C.muted },
});

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.cell}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{printable(value)}</Text>
    </View>
  );
}

function answerText(item: Tables<'pm_checklist_items'>, r: Tables<'pm_responses'> | undefined): string {
  if (!r) return 'Not answered';
  if (r.answer === 'N/A') return 'N/A';
  switch (item.response_type) {
    case 'YES_NO_NA':
      return r.answer ?? 'Not answered';
    case 'NUMBER':
      return r.numeric_value == null ? 'Not answered' : formatNumber(r.numeric_value, item.unit, 3);
    case 'MULTI_SELECT':
      return r.selected_options?.join(', ') || 'Not answered';
    case 'DATE':
      return r.date_value ?? 'Not answered';
    case 'DATETIME':
      return formatDateTime(r.datetime_value);
    case 'PHOTO':
      return 'Photo';
    default:
      return r.text_value || 'Not answered';
  }
}

/** The PM visit report, laid out like the IPT PowerTech paper checklist it replaces. */
export function PmReportDocument({ data }: { data: PmReportData }) {
  const { detail, site, failures, photos, photosOmitted } = data;
  const { visit, raw, sections, items, readingFields, responses, readings, analytics } = detail;
  const progress = visitProgress(detail.state);
  const responseBy = new Map(responses.map((r) => [r.checklist_item_id, r]));
  const readingBy = new Map(readings.map((r) => [r.reading_field_id, r]));
  const na = new Set(raw.not_applicable_sections);
  const kw = analytics.dc?.dc_power_kw ?? dcPowerKw(analytics.dc?.rectifier_voltage_v, analytics.dc?.load_current_a);
  const high = dcHighLoad(kw, analytics.dc?.load_current_a, data.dcThresholds);
  const title = `PM Report — ${visit.site_code} ${visit.site_name}`;

  return (
    <Document title={printable(title)} author="IPT PowerTech PM System" subject="Preventive maintenance report" creator="IPT PowerTech PM System">
      <Page size="A4" style={s.page} wrap>
        <View style={s.header} fixed>
          <View>
            <Text style={s.brand}>IPT PowerTech</Text>
            <Text style={s.brandSub}>Telecom site power — preventive maintenance</Text>
          </View>
          <View>
            <Text style={s.title}>PM Report</Text>
            <Text style={[s.brandSub, { textAlign: 'right' }]}>
              {printable(`${visit.site_code} ${visit.site_name}`)} · {humanizeStatus(visit.status!)}
            </Text>
          </View>
        </View>

        {visit.is_demo ? <Text style={s.demo}>DEMO DATA — reference example, not a live operational record</Text> : null}

        <View style={s.grid}>
          <Cell label="Site ID" value={visit.site_code ?? '—'} />
          <Cell label="Site name" value={visit.site_name ?? '—'} />
          <Cell label="Region" value={site?.region_name ?? '—'} />
          <Cell label="County" value={site?.county_name ?? '—'} />
          <Cell label="Technician" value={visit.technician_name ?? '—'} />
          <Cell label="Supervisor" value={visit.supervisor_name ?? '—'} />
          <Cell label="Started" value={formatDateTime(visit.started_at)} />
          <Cell label="Submitted" value={formatDateTime(visit.submitted_at)} />
          <Cell label="Status" value={humanizeStatus(visit.status!)} />
          <Cell label="Completion" value={`${visit.completion_pct}%`} />
          <Cell label="Failures" value={String(visit.failure_count ?? 0)} />
          <Cell label="Template" value={`v${visit.template_version}`} />
          <Cell
            label="GPS check-in"
            value={raw.gps_status ? `${humanizeStatus(raw.gps_status)}${raw.gps_distance_m != null ? `, ${formatNumber(raw.gps_distance_m, 'm', 0)} from site` : ''}` : 'Not recorded'}
          />
          <Cell label="Position" value={raw.gps_latitude != null ? `${raw.gps_latitude.toFixed(5)}, ${raw.gps_longitude?.toFixed(5)}` : '—'} />
          <Cell label="Radius / mode" value={raw.gps_radius_m != null ? `${raw.gps_radius_m} m / ${humanizeStatus(raw.geofence_mode ?? '')}` : '—'} />
          <Cell label="Reviewed" value={visit.reviewed_at ? `${formatDateTime(visit.reviewed_at)} by ${visit.reviewed_by_name ?? '—'}` : '—'} />
        </View>
        {raw.outside_radius_reason ? <Text style={s.note}>Reason given for starting outside the site area: {printable(raw.outside_radius_reason)}</Text> : null}

        {sections
          .filter((sec) => sec.is_active)
          .map((sec) => {
            const p = progress.sections.find((x) => x.code === sec.code);
            const secItems = items.filter((i) => i.section_id === sec.id && i.is_active);
            const secFields = readingFields.filter((f) => f.section_id === sec.id && f.is_active);
            const secPhotos = photos.filter((ph) => ph.sectionId === sec.id);
            return (
              <View key={sec.id} wrap>
                <Text style={s.h2} minPresenceAhead={80}>
                  {printable(sec.name)}
                  {na.has(sec.code) ? ' — not applicable' : ` — ${p?.done ?? 0}/${p?.required ?? 0} required${p?.failures ? `, ${p.failures} failure(s)` : ''}`}
                </Text>
                {na.has(sec.code) ? null : (
                  <>
                    {secFields.length ? (
                      <View style={s.readings}>
                        {secFields.map((f) => {
                          const r = readingBy.get(f.id);
                          const v = r?.numeric_value != null ? formatNumber(r.numeric_value, f.unit, 3) : r?.text_value || '—';
                          return (
                            <View key={f.id} style={s.reading} wrap={false}>
                              <Text style={s.label}>{printable(f.label)}</Text>
                              <Text style={s.value}>{printable(v)}</Text>
                            </View>
                          );
                        })}
                      </View>
                    ) : null}
                    {sec.category === 'DC_SYSTEM' && (analytics.dc || analytics.phases.length) ? (
                      <Text style={s.note}>
                        DC power (calculated V × A ÷ 1000): {formatNumber(kw, 'kW', 3)}
                        {high.kw || high.current ? ' — HIGH LOAD against the configured threshold' : ''}
                        {analytics.phases.length
                          ? ` · Phase currents: ${analytics.phases.map((ph) => `P${ph.phase_number} ${formatNumber(ph.amp_value, ph.unit, 1)}`).join(', ')} (total ${formatNumber(totalPhaseCurrentA(analytics.phases.map((x) => x.amp_value)), 'A', 1)})`
                          : ''}
                      </Text>
                    ) : null}
                    {secItems.map((item) => {
                      const r = responseBy.get(item.id);
                      const failed = isFailure(item, r?.answer);
                      return (
                        <View key={item.id} style={failed ? [s.row, s.rowFail] : s.row} wrap={false}>
                          <View style={s.prompt}>
                            <Text>{printable(r?.prompt_snapshot || item.prompt)}</Text>
                            {r?.comment ? <Text style={s.comment}>Comment: {printable(r.comment)}</Text> : null}
                          </View>
                          <Text style={[s.answer, failed ? { color: C.danger } : {}]}>
                            {printable(answerText(item, r))}
                            {failed ? ` · FAILURE (${humanizeStatus(item.failure_severity)})` : ''}
                          </Text>
                        </View>
                      );
                    })}
                    {secPhotos.length ? (
                      <View style={s.photos}>
                        {secPhotos.map((ph) => {
                          const item = items.find((i) => i.id === ph.itemId);
                          return (
                            <View key={ph.id} style={s.photo} wrap={false}>
                              {ph.data ? (
                                // react-pdf <Image> (not an HTML img); the caption below describes the photo.
                                // eslint-disable-next-line jsx-a11y/alt-text
                                <Image style={s.img} src={{ data: ph.data, format: ph.format }} />
                              ) : (
                                <View style={[s.img, { justifyContent: 'center', alignItems: 'center', backgroundColor: C.soft }]}>
                                  <Text style={s.note}>Photo not available</Text>
                                </View>
                              )}
                              <Text style={s.note}>
                                {printable(item?.prompt ?? 'Section photo')} · {formatDateTime(ph.takenAt)}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    ) : null}
                  </>
                )}
              </View>
            );
          })}
        {photosOmitted ? <Text style={s.note}>{photosOmitted} further photo(s) are available in the web portal.</Text> : null}

        <Text style={s.h2} minPresenceAhead={40}>Failures raised</Text>
        {failures.length === 0 ? (
          <Text>No failures were recorded in this PM.</Text>
        ) : (
          failures.map((f) => (
            <View key={f.failure_number} style={s.row} wrap={false}>
              <Text style={s.prompt}>
                {f.failure_number} — {printable(f.description)}
              </Text>
              <Text style={s.answer}>
                {humanizeStatus(f.severity!)} · {humanizeStatus(f.status!)}
              </Text>
            </View>
          ))
        )}

        <Text style={s.h2} minPresenceAhead={40}>Overall comments and review</Text>
        <Text>{printable(raw.overall_comments) || 'No overall comments.'}</Text>
        {visit.review_comments ? <Text style={{ marginTop: 4 }}>Supervisor: {printable(visit.review_comments)}</Text> : null}

        <View style={s.sign} wrap={false}>
          <View style={s.signBox}>
            <Text>Technician: {printable(visit.technician_name)}</Text>
            <Text style={s.note}>Signature / date</Text>
          </View>
          <View style={s.signBox}>
            <Text>Supervisor: {printable(visit.supervisor_name ?? '')}</Text>
            <Text style={s.note}>Signature / date</Text>
          </View>
        </View>

        <View style={s.footer} fixed>
          <Text>
            Generated {formatDateTime(data.generatedAt)} by {printable(data.generatedBy)} · IPT PowerTech PM System
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
