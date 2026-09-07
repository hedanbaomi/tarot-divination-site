import XCTest
import UIKit
import WebKit
@testable import Quareia

/// Exercises the shipping backup API against WebKit's real persistent IndexedDB.
@MainActor
final class WebBackupIntegrationTests: XCTestCase {
    private var controller: WebAppViewController!
    private var window: UIWindow!
    private var web: WKWebView!

    override func setUp() async throws {
        controller = WebAppViewController(arguments: [])
        window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = controller
        window.makeKeyAndVisible()
        controller.loadViewIfNeeded()
        web = try XCTUnwrap(controller.view as? WKWebView)
        try await ready()
    }

    override func tearDown() async throws {
        web.stopLoading()
        window.isHidden = true
        window.rootViewController = nil
        web = nil
        controller = nil
        window = nil
    }

    func testRealIndexedDBBackupRoundtripRejectsCorruptionAndDuplicates() async throws {
        let result = try await script("""
        const api = window.DivinationBackup;
        const original = await api.exportBackup();
        try {
          const target = await api.createSnapshot();
          const record = DivinationHistoryRecords.buildReadingRecord({
            id: 'ios-backup-integration', createdAt: '2026-09-07T00:00:00.000Z',
            deckType: 'tarot', deckMode: 'tarot', deckName: 'Synthetic deck',
            spreadId: 'single', spreadName: 'Synthetic spread',
            orientationMode: 'mixed', filterMode: 'mixed', overviewMethod: 'not-applicable',
            positions: [{number: 1, name: 'Position'}],
            entries: [{slotIndex: 0, layer: null, orientation: 'upright',
              card: {id: 'major-00', number: '00', name: 'Synthetic', arcana: 'major', suit: ''}}]
          });
          target.history = DivinationHistoryRecords.createExportEnvelope([record], target.exportedAt);
          target.settings = {theme: 'grove', locale: 'en'};
          let raw;
          const library = DivinationCustomSpreads.createLibrary({platform:'android', storage:{
            getItem(){return null},setItem(key,value){raw=value}
          }});
          library.upsert({name:'Synthetic template',description:'',columns:1,rows:1,
            deckScope:'any',tarotMode:'mixed',stackingMode:'single',
            positions:[{name:'Position',meaning:'',column:1,row:1}]});
          target.customSpreads = JSON.parse(raw);
          const board = FreeBoardModel.createController({
            deck:{id:'tarot',deckName:'Synthetic',cardIds:['major-0'],cards:[{id:'major-0',cardType:'tarot'}]},
            settings:{deckType:'tarot',orientationMode:'mixed',filterMode:'major-then-minor',overviewMethod:'not-applicable'}
          });
          board.draw('major-0',{orientation:'upright',x:24,y:18,boardRotation:90,revealed:true});
          target.draft = JSON.parse(board.serializeDraft());
          await api.importBackup(target);
          const first = await api.createSnapshot();
          await api.importBackup(await api.exportBackup());
          const second = await api.createSnapshot();
          let rejected = 0;
          for (const broken of ['{', {...target,version:999},
             {...target,customSpreads:{v:999,items:[]}}, ' '.repeat(api.MAX_BYTES+1)]) {
            try { await api.importBackup(broken); } catch (_) { rejected++; }
          }
          const after = await api.createSnapshot();
          const equalPayload = value => JSON.stringify([value.history.records,value.customSpreads,value.draft,value.settings]);
          return {exact:equalPayload(target)===equalPayload(second),count:second.history.records.length, templates:second.customSpreads.items.length,
            draft:second.draft!==null, rejected, stable:equalPayload(first)===equalPayload(second)&&equalPayload(second)===equalPayload(after)};
        } finally { await api.importBackup(original); }
        """)
        XCTAssertEqual(result["count"] as? Int, 1)
        XCTAssertEqual(result["templates"] as? Int, 1)
        XCTAssertEqual(result["draft"] as? Bool, true)
        XCTAssertEqual(result["rejected"] as? Int, 4)
        XCTAssertEqual(result["stable"] as? Bool, true)
        XCTAssertEqual(result["exact"] as? Bool, true)
    }

    func testJournalRecoveryAndWebContentReloadPreserveCommittedData() async throws {
        _ = try await script("""
        const api = DivinationBackup;
        const before = await api.createSnapshot();
        const record = DivinationHistoryRecords.buildReadingRecord({
          id:'ios-reload-sentinel',createdAt:'2026-09-07T00:00:00.000Z',
          deckType:'tarot',deckMode:'tarot',deckName:'Synthetic',spreadId:'single',spreadName:'Synthetic',
          orientationMode:'mixed',filterMode:'mixed',overviewMethod:'not-applicable',
          positions:[{number:1,name:'Position'}],entries:[{slotIndex:0,layer:null,orientation:'upright',
            card:{id:'major-00',number:'00',name:'Synthetic',arcana:'major',suit:''}}]
        });
        before.history = DivinationHistoryRecords.createExportEnvelope(before.history.records.filter(r=>r.id!==record.id).concat([record]),before.exportedAt);
        await api.importBackup(before);
        await new Promise((resolve,reject)=>{
          const request=indexedDB.open(api.JOURNAL_DB,1);
          request.onsuccess=()=>{
            const db=request.result, tx=db.transaction(api.JOURNAL_STORE,'readwrite');
            tx.objectStore(api.JOURNAL_STORE).put({key:api.JOURNAL_KEY,phase:'prepared',previous:before});
            tx.oncomplete=()=>{db.close();resolve()}; tx.onerror=()=>reject(tx.error);
          };request.onerror=()=>reject(request.error);
        });
        localStorage.setItem(api.SETTINGS_KEYS.theme,'ember');
        const recovered=await api.recoverIfNeeded();
        const after=await api.createSnapshot();
        if(!recovered.recovered || JSON.stringify(before.settings)!==JSON.stringify(after.settings)) throw Error('Recovery failed');
        const again=await api.recoverIfNeeded();
        if(again.recovered) throw Error('Journal was not cleared');
        localStorage.setItem('ios-integration-reload','retained');
        window.iosOldDocument=true;
        return {ok:true};
        """)
        controller.webViewWebContentProcessDidTerminate(web)
        try await ready(requireNewDocument: true)
        let result = try await script("const data=await DivinationBackup.createSnapshot();return {newDocument:!window.iosOldDocument,history:data.history.records.some(r=>r.id==='ios-reload-sentinel'),retained:localStorage.getItem('ios-integration-reload')==='retained',origin:location.href};")
        XCTAssertEqual(result["retained"] as? Bool, true)
        XCTAssertEqual(result["origin"] as? String, "quareia-app://app/index.html")
        XCTAssertEqual(result["newDocument"] as? Bool, true)
        XCTAssertEqual(result["history"] as? Bool, true)
        _ = try await script("localStorage.removeItem('ios-integration-reload');const data=await DivinationBackup.createSnapshot();data.history.records=data.history.records.filter(r=>r.id!=='ios-reload-sentinel');await DivinationBackup.importBackup(data);return {ok:true};")
    }

    private func ready(requireNewDocument: Bool = false) async throws {
        for _ in 0..<150 {
            if !web.isLoading,
               let result = try? await web.callAsyncJavaScript(
                "if (!window.DivinationBackup || (requireNewDocument && window.iosOldDocument)) return false; await DivinationBackup.ready; return true;",
                arguments: ["requireNewDocument": requireNewDocument], in: nil, contentWorld: .page), result as? Bool == true { return }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTFail("Shipping WebKit backup API did not become ready")
        throw NSError(domain: "WebBackupIntegrationTests", code: 1)
    }

    private func script(_ source: String) async throws -> [String: Any] {
        let result = try await web.callAsyncJavaScript(source, arguments: [:], in: nil, contentWorld: .page)
        return try XCTUnwrap(result as? [String: Any])
    }
}
