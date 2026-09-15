import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { DISPLAY_GOVERNOR_DDL } from '../react-widgets/core/display-governor-schema.js';
import { getPostgresDatabase } from '../react-widgets/core/postgres-database.js';
import { DisplayGovernorStore } from './display-governor-store.js';
import { DEFAULT_DISPLAY_POLICY as policy, MINUTE, initialState, type Candidate, type State } from './display-governor.js';
import { withLegacyDisplayPermit } from './display-governor-ownership.js';
import { getDeviceFrame, upsertDeviceFrame } from './device-frame-cache.js';
import { recordDisplayAck } from './device-frame-ack.js';
import { pushToEinkDevice, crc32Hex, type EinkDevice } from './eink-converter.js';
import { candidateStillAdmitted, listGovernorCandidates, loadAdmittedInventory,
  savePeriodicCandidate, weatherCatalogEntry, memoCatalogEntry, loadAdmittedPeriodic } from './display-governor-catalog.js';
import { runGovernorDeviceTick } from './display-governor-worker.js';

const url = process.env.Q0_GOVERNOR_PG_URL;
if (!url) throw new Error('Use bun run test:display-governor:pg (isolated cluster); no silent skip');
const parsed = new URL(url);
if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/q0_display_governor_test') {
  throw new Error('Refusing non-isolated PostgreSQL test target');
}
const schema = `q0_governor_${randomBytes(8).toString('hex')}`;
const admin = new Pool({ connectionString: url, max: 2 });
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema} -c timezone=Asia/Shanghai`, max: 8 });
const store = new DisplayGovernorStore(pool);
const secondStore = new DisplayGovernorStore(pool);
const database = getPostgresDatabase();
const oldGetPool = database.getPool;
const bitmap = Buffer.alloc(8, 0xa5);
const prepared = { bitmap, width: 8, height: 8 };
const device: EinkDevice = { id: 'test-screen', name: 'synthetic', baseUrl: 'http://127.0.0.1:1',
  token: 'test-only', width: 8, height: 8, colorMode: 'mono-1bit', planeCount: 1, wireProtocol: 'epd1-v1' };
const candidate = (key = 'news:test'): Candidate => ({ key, exposureKey: key, source: 'solidot', kind: 'news',
  version: 'article-v1', admitted: true, eligibleFromMs: Date.now() - MINUTE,
  expiresAtMs: Date.now() + 24 * 60 * MINUTE, dataRef: `fixture:${key}` });
const allowed = async () => true;
async function state(id = device.id): Promise<State> {
  return (await pool.query<{ state: State }>('SELECT state FROM display_governor_states WHERE device_id=$1', [id])).rows[0].state;
}
async function publishOne(c = candidate(), id = device.id): Promise<{ frameId: string; planId: string }> {
  await store.enroll(id, 0);
  const plan = await store.reserve(id, [c], policy);
  expect(plan.decision.kind).toBe('select');
  const planId = plan.state.pending!.id;
  const frameId = await store.publish(id, planId, prepared, policy, allowed);
  return { frameId, planId };
}
async function seedNews(id: number, hoursOld: number, metadata: Record<string, unknown> = {}): Promise<void> {
  await pool.query(`INSERT INTO content_inventory(id,fingerprint,source,title,link,raw_content,processed_content,state,created_at)
    VALUES($1,$2,'solidot','Synthetic test story','https://example.invalid/test','{}',$3::jsonb,'pushed',
      LOCALTIMESTAMP - ($4 * INTERVAL '1 hour'))`,
    [id, `subject-${id}`, JSON.stringify({ title: 'Synthetic', message: 'Fixture only', metadata }), hoursOld]);
}

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await pool.query(`
    CREATE TABLE device_deliveries (
      id BIGSERIAL PRIMARY KEY, content_id INTEGER, device_id TEXT, state TEXT, lease_owner TEXT,
      lease_expires_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
      last_error_code TEXT,last_error TEXT
    );
    CREATE TABLE device_frames (
      device_id TEXT PRIMARY KEY,frame_data BYTEA,frame_id TEXT,frame_crc32 TEXT,
      width INTEGER,height INTEGER,plane_count INTEGER,updated_at TIMESTAMPTZ
    );
    CREATE TABLE device_frame_acks (
      id BIGSERIAL PRIMARY KEY,device_id TEXT,frame_id TEXT,frame_crc32 TEXT,result TEXT,
      refresh_ms INTEGER,firmware TEXT,rssi INTEGER,free_heap INTEGER,current_match BOOLEAN,
      crc_verified BOOLEAN,acked_at TIMESTAMPTZ, UNIQUE(device_id,frame_id)
    );
    CREATE TABLE content_inventory (
      id INTEGER PRIMARY KEY,fingerprint TEXT,source TEXT,title TEXT,link TEXT,
      raw_content JSONB,processed_content JSONB,state TEXT,created_at TIMESTAMP,expires_at TIMESTAMP
    );
    CREATE TABLE news_scheduler_jobs (id TEXT PRIMARY KEY,enabled BOOLEAN,data_source TEXT,renderer TEXT);
    CREATE TABLE memos (id TEXT PRIMARY KEY,enabled BOOLEAN,status TEXT,target_renderer TEXT);
    CREATE TABLE push_devices (id TEXT PRIMARY KEY,base_url TEXT,enabled BOOLEAN,kind TEXT);
  `);
  for (const sql of DISPLAY_GOVERNOR_DDL) await pool.query(sql);
  // Verify that the shipped migration really is idempotent against already existing tables/indexes.
  for (const sql of DISPLAY_GOVERNOR_DDL) await pool.query(sql);
  database.getPool = () => pool;
});
beforeEach(async () => {
  await pool.query(`TRUNCATE display_governor_states,display_governor_events,display_governor_candidates,
    device_deliveries,device_frames,device_frame_acks,content_inventory,news_scheduler_jobs,memos,push_devices`);
  await pool.query("INSERT INTO push_devices VALUES ('test-screen','http://127.0.0.1:1',true,'eink-local')");
});
afterAll(async () => {
  database.getPool = oldGetPool;
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

describe('display governor actual PostgreSQL state/side-effect integration', () => {
  test('concurrent workers reserve exactly one plan and one generation', async () => {
    await store.enroll(device.id, 0);
    const [a,b] = await Promise.all([store.reserve(device.id,[candidate()],policy), secondStore.reserve(device.id,[candidate()],policy)]);
    expect([a,b].filter(result => result.decision.kind === 'select')).toHaveLength(1);
    expect((await state()).generation).toBe(1);
    expect(Number((await pool.query("SELECT count(*) n FROM display_governor_events WHERE event='reserved'")).rows[0].n)).toBe(1);
  });
  test('one publication commits exact frame bytes, pending state and matching audit', async () => {
    const { frameId } = await publishOne();
    const frame = await getDeviceFrame(device.id);
    expect(frame?.frame_id).toBe(frameId);
    expect(frame?.frame_data).toEqual(bitmap);
    expect((await state()).current).toBeNull();
    expect((await state()).pending?.phase).toBe('published');
    const event = await pool.query("SELECT details FROM display_governor_events WHERE event='published'");
    expect(event.rows[0].details.frameId).toBe(frameId);
  });
  test('published notification uses the actual long-poll listener contract', async () => {
    const listener = await pool.connect();
    try {
      await listener.query('LISTEN quote0_device_frame_updates');
      const received = new Promise<{ payload?: string }>((resolve,reject) => {
        const timer = setTimeout(() => reject(new Error('No committed publication notification')), 3000);
        listener.once('notification', message => { clearTimeout(timer); resolve(message); });
      });
      const { frameId } = await publishOne();
      const message = await received;
      expect(JSON.parse(message.payload!)).toEqual({ device_id: device.id, frame_id: frameId });
    } finally { await listener.query('UNLISTEN *'); listener.release(); }
  });
  test('failure after frame INSERT rolls back frame + state + publication event', async () => {
    await store.enroll(device.id, 0);
    const plan = await store.reserve(device.id, [candidate()], policy);
    await pool.query("ALTER TABLE display_governor_events ADD CONSTRAINT test_reject_publication CHECK(event <> 'published')");
    try {
      await expect(store.publish(device.id,plan.state.pending!.id,prepared,policy,allowed)).rejects.toThrow();
      expect((await pool.query('SELECT * FROM device_frames')).rowCount).toBe(0);
      expect((await state()).pending?.phase).toBe('reserved');
      expect((await pool.query("SELECT * FROM display_governor_events WHERE event='published'")).rowCount).toBe(0);
    } finally { await pool.query('ALTER TABLE display_governor_events DROP CONSTRAINT test_reject_publication'); }
  });
  test('only panel refresh ACK creates exposure; duplicate cannot extend dwell', async () => {
    const { frameId } = await publishOne();
    const ack = { frameId, crc32: crc32Hex(bitmap), result: 'displayed' as const, refreshMs: 1234 };
    const first = await recordDisplayAck(device.id,ack);
    expect(first.governorAccepted).toBe(true);
    const s = await state();
    expect(s.current!.protectedUntilMs - s.current!.acknowledgedAtMs).toBe(MINUTE);
    const duplicate = await recordDisplayAck(device.id,ack);
    expect(duplicate.governorAccepted).toBe(false);
    expect(await state()).toEqual(s);
    expect((await pool.query("SELECT * FROM display_governor_events WHERE event='refresh-confirmed'")).rowCount).toBe(1);
    expect((await pool.query('SELECT * FROM device_frame_acks')).rowCount).toBe(1);
  });
  test('a restarted worker observes the same durable dwell/cooldown', async () => {
    const { frameId } = await publishOne();
    await store.acknowledgeFrame(device.id,{ frameId,crc32:crc32Hex(bitmap),result:'displayed' });
    const restarted = new DisplayGovernorStore(pool);
    expect((await restarted.reserve(device.id,[candidate('other')],policy)).decision)
      .toMatchObject({kind:'hold',reason:'minimum-dwell'});
  });
  test('CRC mismatch and failed refresh do not advance exposure', async () => {
    const { frameId } = await publishOne();
    expect((await store.acknowledgeFrame(device.id,{frameId,crc32:'00000000',result:'displayed'}))?.accepted).toBe(false);
    expect((await store.acknowledgeFrame(device.id,{frameId,crc32:crc32Hex(bitmap),result:'failed'}))?.accepted).toBe(false);
    expect((await state()).current).toBeNull();
  });
  test('identical pixels get distinct wire tokens across generations; delayed old ACK is rejected', async () => {
    const first = await publishOne();
    await store.acknowledgeFrame(device.id,{frameId:first.frameId,crc32:crc32Hex(bitmap),result:'displayed'});
    // Test-only elapse of dwell, keeping generation and prior publication evidence intact.
    await pool.query("UPDATE display_governor_states SET state=jsonb_set(state,'{current,protectedUntilMs}','0')");
    const plan = await secondStore.reserve(device.id,[candidate('another-article')],policy);
    const next = await secondStore.publish(device.id,plan.state.pending!.id,prepared,policy,allowed);
    expect(next).not.toBe(first.frameId);
    expect((await store.acknowledgeFrame(device.id,{frameId:first.frameId,crc32:crc32Hex(bitmap),result:'displayed'}))?.accepted).toBe(false);
    expect((await store.acknowledgeFrame(device.id,{frameId:next,crc32:crc32Hex(bitmap),result:'displayed'}))?.accepted).toBe(true);
  });
  test('late refresh ACK remains uncertain and hidden from further Pulls', async () => {
    const { frameId } = await publishOne();
    await pool.query("UPDATE display_governor_states SET state=jsonb_set(state,'{pending,deadlineMs}','1')");
    expect((await store.acknowledgeFrame(device.id,{frameId,crc32:crc32Hex(bitmap),result:'displayed'}))?.reason).toBe('late-ack');
    expect(await getDeviceFrame(device.id)).toBeNull();
    const transition = await store.reserve(device.id,[candidate('new')],policy);
    expect(transition.events).toEqual(['refresh-ack-timeout']);
    expect((await state()).lastByContent).toEqual({});
  });
  test('unified ownership prevents ordinary cache and physical Push writes', async () => {
    const { frameId } = await publishOne();
    await upsertDeviceFrame({deviceId:device.id,bitmap:Buffer.alloc(8,0),width:8,height:8});
    expect((await getDeviceFrame(device.id))?.frame_id).toBe(frameId);
    // baseUrl is loopback port 1; an accidental network send would fail this assertion.
    const push = await pushToEinkDevice(device,bitmap);
    expect(push.ok).toBe(false);
    expect(push.error).toContain('display_governor_owned');
  });
  test('an alias device ID cannot Push to a physically owned endpoint', async () => {
    await store.enroll(device.id,0);
    const alias = { ...device, id:'alias-screen', baseUrl:'http://127.0.0.1:1/' };
    await pool.query("INSERT INTO push_devices VALUES('alias-screen','http://127.0.0.1:1/',true,'eink-local')");
    const result = await pushToEinkDevice(alias,bitmap);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('display_governor_owned');
    await expect(store.enroll('alias-screen',0)).rejects.toThrow('same physical endpoint');
  });
  test('DB failure is not permission to send a frame', async () => {
    let invoked=false;
    const broken = { connect: async () => { throw new Error('synthetic-db-unavailable'); } } as unknown as Pool;
    await expect(withLegacyDisplayPermit('unmanaged',broken,async () => { invoked=true; })).rejects.toThrow('synthetic-db-unavailable');
    expect(invoked).toBe(false);
  });
  test('legacy succeeded deliveries seed news cooldown/source history exactly once', async () => {
    await seedNews(1,1);
    await pool.query(`INSERT INTO device_deliveries(content_id,device_id,state,finished_at,updated_at)
      VALUES(1,$1,'succeeded',now()-interval '10 minutes',now()-interval '10 minutes')`,[device.id]);
    await store.enroll(device.id,0);
    expect(await store.importLegacyNewsExposureHistory(device.id)).toBe(1);
    const imported=await state();
    const key='news:subject-1';
    expect(imported.lastByContent[key]?.planId).toMatch(/^legacy-delivery:/);
    expect(imported.lastByExposure[key]).toBeGreaterThan(0);
    expect(imported.lastBySource.solidot).toBe(imported.lastByExposure[key]);
    expect(await store.importLegacyNewsExposureHistory(device.id)).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS n FROM display_governor_events WHERE event='legacy-history-imported'")).rows[0].n).toBe(1);
    const decision=await store.reserve(device.id,[candidate('news:subject-1')],policy);
    expect(decision.decision).toMatchObject({kind:'hold'});
  });

  test('ownership persists without an allowlist; normal legacy device remains permitted', async () => {
    await store.enroll(device.id,0);
    let called = 0;
    expect((await withLegacyDisplayPermit(device.id,pool,async () => {called++;})).permitted).toBe(false);
    expect((await withLegacyDisplayPermit('unmanaged',pool,async () => {called++; return 7;}))).toEqual({permitted:true,value:7});
    expect(called).toBe(1);
  });

  test('explicit release keeps the last frame visible and restores legacy ownership', async () => {
    const {frameId}=await publishOne();
    await store.acknowledgeFrame(device.id,{frameId,crc32:crc32Hex(bitmap),result:'displayed'});
    expect(await store.release(device.id)).toBe(true);
    expect((await pool.query('SELECT * FROM display_governor_states WHERE device_id=$1',[device.id])).rowCount).toBe(0);
    expect((await getDeviceFrame(device.id))?.frame_id).toBe(frameId);
    let called=0;
    expect((await withLegacyDisplayPermit(device.id,pool,async () => {called++; return 'legacy-restored';})))
      .toEqual({permitted:true,value:'legacy-restored'});
    expect(called).toBe(1);
    expect((await pool.query("SELECT * FROM display_governor_events WHERE event='released'")).rowCount).toBe(1);
    expect(await store.release(device.id)).toBe(false);
  });

  test('release refuses an in-flight governor publication', async () => {
    await publishOne();
    await expect(store.release(device.id)).rejects.toThrow('in-flight governor publication');
    expect((await pool.query('SELECT * FROM display_governor_states WHERE device_id=$1',[device.id])).rowCount).toBe(1);
  });
  test('exclusive enrollment waits for an in-flight legacy side effect', async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release=resolve; });
    const started = new Promise<void>(resolve => { entered=resolve; });
    const legacy = withLegacyDisplayPermit(device.id,pool,async () => { entered(); await gate; });
    await started;
    let enrolled = false;
    const enrollment = store.enroll(device.id,0).then(() => { enrolled=true; });
    try {
      await new Promise(resolve => setTimeout(resolve,40));
      expect(enrolled).toBe(false);
    } finally { release(); await legacy; await enrollment; }
    expect(enrolled).toBe(true);
  });
  test('initial drain and old leased delivery both block premature new selection', async () => {
    await store.enroll(device.id,180_000);
    expect((await store.reserve(device.id,[candidate()],policy)).decision.reason).toBe('uncertain-refresh');
    await pool.query("UPDATE display_governor_states SET state=jsonb_set(state,'{uncertainProtectedUntilMs}','0')");
    await pool.query("INSERT INTO device_deliveries(device_id,state,lease_owner,lease_expires_at) VALUES($1,'leased','old-worker',now()+interval '1 minute')",[device.id]);
    expect((await store.reserve(device.id,[candidate()],policy)).decision).toMatchObject({kind:'hold',excluded:{'legacy-in-flight':1}});
  });
  test('enrollment supersedes only unleased pending legacy deliveries', async () => {
    await pool.query(`INSERT INTO device_deliveries(device_id,state,lease_owner,lease_expires_at)
      VALUES($1,'queued',NULL,NULL),($1,'leased','old-worker',now()+interval '1 minute'),($1,'succeeded',NULL,NULL)`,[device.id]);
    await store.enroll(device.id,0);
    const rows = await pool.query('SELECT state FROM device_deliveries ORDER BY id');
    expect(rows.rows.map(row=>row.state)).toEqual(['superseded','leased','succeeded']);
  });
  test('renderer error clears its own reservation without a fake successful frame', async () => {
    await store.enroll(device.id,0);
    await expect(runGovernorDeviceTick(store,device,[candidate()],policy,async () => {throw new Error('synthetic-render-error');})).rejects.toThrow('synthetic-render-error');
    expect((await state()).pending).toBeNull();
    expect((await state()).lastByContent).toEqual({});
    expect((await pool.query('SELECT * FROM device_frames')).rowCount).toBe(0);
    expect((await pool.query("SELECT * FROM display_governor_events WHERE event='render-failed'")).rowCount).toBe(1);
  });
});

describe('real inventory/weather/memo admission SQL', () => {
  test('catalog admits >6h valid articles but excludes stale, HOLD and incompatible Research', async () => {
    await seedNews(1,9);
    await seedNews(2,25);
    await seedNews(3,1,{contentQuality:{disposition:'hold'}});
    await seedNews(4,1,{researchGate:{required:true,state:'pending',researchPolicyVersion:'quote0-research-triage/v13'}});
    await seedNews(5,1,{researchGate:{required:true,state:'ready',researchPolicyVersion:'invalid-policy'}});
    await seedNews(6,1,{researchGate:{required:true,state:'ready',researchPolicyVersion:'quote0-research-triage/v13'}});
    expect((await listGovernorCandidates(pool)).map(c=>c.key)).toEqual(['news:subject-1','news:subject-6']);
  });
  test('materialization changing the snapshot invalidates a stale rendered plan', async () => {
    await seedNews(1,1);
    const [c] = await listGovernorCandidates(pool);
    expect(await loadAdmittedInventory(pool,c)).not.toBeNull();
    await pool.query("UPDATE content_inventory SET processed_content='{}'");
    expect(await loadAdmittedInventory(pool,c)).toBeNull();
  });
  test('a newly HOLD article cannot publish between reservation and render completion', async () => {
    await seedNews(1,1);
    const [c] = await listGovernorCandidates(pool);
    await store.enroll(device.id,0);
    const plan = await store.reserve(device.id,[c],policy);
    await pool.query(`UPDATE content_inventory SET processed_content=$1::jsonb`,[JSON.stringify({metadata:{contentQuality:{disposition:'hold'}}})]);
    await expect(store.publish(device.id,plan.state.pending!.id,prepared,policy,candidateStillAdmitted)).rejects.toThrow('admission revoked');
    expect((await pool.query('SELECT * FROM device_frames')).rowCount).toBe(0);
  });
  test('worker vertical slice uses real catalog, transaction, frame reader and ACK state', async () => {
    await seedNews(1,1);
    const catalog = await listGovernorCandidates(pool);
    await store.enroll(device.id,0);
    await runGovernorDeviceTick(store,device,catalog,policy,async () => prepared);
    const frame = await getDeviceFrame(device.id);
    expect(frame?.frame_data).toEqual(bitmap);
    const ack = await recordDisplayAck(device.id,{frameId:frame!.frame_id!,crc32:crc32Hex(bitmap),result:'displayed'});
    expect(ack.governorAccepted).toBe(true);
    expect((await state()).current?.candidate.key).toBe(catalog[0].key);
  });
  test('weather storage is latest-only and source observation time cannot move backward', async () => {
    await pool.query("INSERT INTO news_scheduler_jobs VALUES('weather-job',true,'weather','local-eink')");
    const now=Date.now();
    const data={city:'广州',temperature:30,humidity:70,weather:'晴',updateTime:new Date(now-MINUTE).toISOString()};
    const latest=weatherCatalogEntry('weather-job',data,now);
    await savePeriodicCandidate(pool,'weather-job',latest);
    const older=weatherCatalogEntry('weather-job',{...data,temperature:20,updateTime:new Date(now-2*MINUTE).toISOString()},now);
    await savePeriodicCandidate(pool,'weather-job',older);
    const catalog=await listGovernorCandidates(pool);
    expect(catalog).toHaveLength(1);
    expect(catalog[0].version).toBe(latest.candidate.version);
    expect(await loadAdmittedPeriodic(pool,latest.candidate)).toEqual(latest.payload);
    await pool.query("UPDATE news_scheduler_jobs SET enabled=false");
    expect(await listGovernorCandidates(pool)).toEqual([]);
  });
  test('weather refresh does not create a second card and expired snapshots are excluded', async () => {
    await pool.query("INSERT INTO news_scheduler_jobs VALUES('weather-job',true,'weather','local-eink')");
    const now=Date.now();
    const one=weatherCatalogEntry('weather-job',{city:'广州',temperature:30,humidity:70,weather:'晴',updateTime:new Date(now).toISOString()},now);
    await savePeriodicCandidate(pool,'weather-job',one);
    const two=weatherCatalogEntry('weather-job',{...one.payload.weather!,temperature:31},now);
    await savePeriodicCandidate(pool,'weather-job',two);
    expect((await listGovernorCandidates(pool))).toHaveLength(1);
    expect(await loadAdmittedPeriodic(pool,one.candidate)).toBeNull();
    await pool.query("UPDATE display_governor_candidates SET observed_at=now()-interval '3 hours', expires_at=now()-interval '1 hour'");
    expect(await listGovernorCandidates(pool)).toEqual([]);
  });
  test('disabled or removed memos are not resurrected from cached snapshots', async () => {
    await pool.query("INSERT INTO news_scheduler_jobs VALUES('memo-job',true,'memo','device')");
    await pool.query("INSERT INTO memos VALUES('memo-1',true,'ready','both')");
    const c=memoCatalogEntry('memo-job','memo-1','payload/test.png','a'.repeat(64),Date.now());
    await savePeriodicCandidate(pool,'memo-job',c);
    expect(await listGovernorCandidates(pool)).toHaveLength(1);
    await pool.query("UPDATE memos SET enabled=false");
    expect(await listGovernorCandidates(pool)).toEqual([]);
    expect(await loadAdmittedPeriodic(pool,c.candidate)).toBeNull();
  });

  test('publication admission lock serializes a concurrent memo disable', async () => {
    await pool.query("INSERT INTO news_scheduler_jobs VALUES('memo-job',true,'memo','device')");
    await pool.query("INSERT INTO memos VALUES('memo-1',true,'ready','both')");
    const c=memoCatalogEntry('memo-job','memo-1','payload/test.png','a'.repeat(64),Date.now());
    await savePeriodicCandidate(pool,'memo-job',c);

    const reader=await pool.connect();
    const writer=await pool.connect();
    try {
      await reader.query('BEGIN');
      expect(await loadAdmittedPeriodic(reader,c.candidate,true)).toEqual(c.payload);
      let disabled=false;
      const disable=writer.query("UPDATE memos SET enabled=false WHERE id='memo-1'").then(() => { disabled=true; });
      await new Promise(resolve => setTimeout(resolve,40));
      expect(disabled).toBe(false);
      await reader.query('COMMIT');
      await disable;
      expect(disabled).toBe(true);
      expect(await loadAdmittedPeriodic(pool,c.candidate)).toBeNull();
    } finally {
      await reader.query('ROLLBACK').catch(()=>{});
      reader.release();
      writer.release();
    }
  });
});
