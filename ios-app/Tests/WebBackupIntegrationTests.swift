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
        // Exercise the real app-host WebView throughout this suite. Replacing
        // the root for each method churns WebContent processes while the
        // original app controller remains alive in the background.
        window = try XCTUnwrap((UIApplication.shared.delegate as? AppDelegate)?.window)
        let navigation = try XCTUnwrap(window.rootViewController as? UINavigationController)
        controller = try XCTUnwrap(navigation.viewControllers.first as? WebAppViewController)
        controller.loadViewIfNeeded()
        web = try XCTUnwrap(controller.view.subviews.compactMap { $0 as? WKWebView }.first)
        try await ready()
    }

    override func tearDown() async throws {
        // Each method restores its synthetic data; the app retains ownership
        // of its window and WebView until XCTest terminates the host.
        web = nil
        controller = nil
        window = nil
    }

    func testAccessibleBoardZoomChangesRenderedCardGeometry() async throws {
        let result = try await script("""
        const area=document.getElementById('freeBoardArea').cloneNode(true);
        area.style.position='fixed';area.style.inset='0';area.style.width='400px';
        document.body.appendChild(area);
        const scopedDocument={
          getElementById(id){return id==='freeBoardArea'?area:area.querySelector('#'+id)},
          createElement(tag){return document.createElement(tag)}
        };
        const values=new Map();
        const ui=DivinationFreeBoardUi.createController({document:scopedDocument,platform:'ios',
          storage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}});
        try {
          ui.enter({deckType:'tarot',deckName:'Synthetic',mode:'upright-only',filterMode:'mixed',
            cards:[{id:'major-0',deck:'tarot',name:'Synthetic',image:''}]},{restoreDraft:false});
          ui.draw('major-0');
          const width=()=>area.querySelector('.free-board-card').getBoundingClientRect().width;
          const before=width();
          scopedDocument.getElementById('freeBoardZoomInBtn').click();
          const enlarged=width();
          scopedDocument.getElementById('freeBoardZoomOutBtn').click();
          const reduced=width();
          scopedDocument.getElementById('freeBoardZoomInBtn').click();
          scopedDocument.getElementById('freeBoardResetViewBtn').click();
          return {before,enlarged,reduced,reset:width(),zoom:ui.getState().viewport.zoom};
        } finally {ui.exit();area.remove();}
        """)
        let before = try XCTUnwrap(result["before"] as? Double)
        let enlarged = try XCTUnwrap(result["enlarged"] as? Double)
        let reduced = try XCTUnwrap(result["reduced"] as? Double)
        let reset = try XCTUnwrap(result["reset"] as? Double)
        XCTAssertGreaterThan(before, 0)
        XCTAssertEqual(enlarged, before * 1.25, accuracy: 1)
        XCTAssertEqual(reduced, before, accuracy: 1)
        XCTAssertEqual(reset, before, accuracy: 1)
        XCTAssertEqual(result["zoom"] as? Double, 1)
    }

    func testNativeAndWebLocaleStayAlignedAtStartupAndAfterChange() async throws {
        let result = try await script("""
        const initial=DivinationI18n.getLocale();
        const stored=localStorage.getItem(DivinationI18n.STORAGE_KEY);
        async function matches(expected) {
          for(let attempt=0;attempt<20;attempt++) {
            if((await QuareiaIOS.hostInfo()).locale===expected) return true;
            await new Promise(resolve=>setTimeout(resolve,25));
          }
          return false;
        }
        try {
          const startup=await matches(initial);
          const changed=initial==='en'?'zh-CN':'en';
          DivinationI18n.setLocale(changed);
          return {startup,changed:await matches(changed)};
        } finally {
          DivinationI18n.setLocale(initial);
          await matches(initial);
          if(stored===null) localStorage.removeItem(DivinationI18n.STORAGE_KEY);
        }
        """)
        XCTAssertEqual(result["startup"] as? Bool, true)
        XCTAssertEqual(result["changed"] as? Bool, true)
    }

    func testNormalDeckImagesAndProtectedProviderAreReachable() async throws {
        let result = try await script("""
        await QuareiaIOS.ready;
        const urls=[tarotDeckFull[0].image,mystagogusDeckFull[0].image,getLxxxiBackImage(),lxxxiDeckFull[0].image];
        const protectedURLs=urls.slice(2);
        for(const name of ['parchment-sun-blank','parchment-sun','sky-face-celestial','sky-face-ember','sky-face-grove']) urls.push('assets/icons/'+name+'.png');
        const loaded=await Promise.all(urls.map(src=>new Promise(resolve=>{
          const image=new Image(); const timeout=setTimeout(()=>resolve(false),5000);
          image.onload=()=>{clearTimeout(timeout);resolve(image.naturalWidth>0&&image.naturalHeight>0)};
          image.onerror=()=>{clearTimeout(timeout);resolve(false)};image.src=src;
        })));
        return {loaded,protected:protectedURLs.every(url=>url.startsWith(__qMediaBase+'/lxxxi-'))};
        """)
        XCTAssertEqual(result["loaded"] as? [Bool], Array(repeating: true, count: 9))
        XCTAssertEqual(result["protected"] as? Bool, true)
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
          const spatialInput = {id:'ios-backup-spatial',createdAt:record.createdAt,
            deckType:'tarot',deckMode:'tarot',deckName:'Synthetic deck',orientationMode:'mixed',
            filterMode:'mixed',overviewMethod:'not-applicable',cards:[{
              cardId:'major-01',cardNumber:'01',cardName:'Synthetic',arcana:'major',suit:'',
              orientation:'reversed',revealed:true,x:24,y:-18,boardRotation:90,z:1,drawOrder:1
            }]};
          const spatial = DivinationHistoryRecords.buildFreeformLayoutRecord(spatialInput);
          const ordered = DivinationHistoryRecords.buildFreeformRecord({...spatialInput,id:'ios-backup-ordered'});
          target.history = DivinationHistoryRecords.createExportEnvelope([record,spatial,ordered], target.exportedAt);
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
          const equalPayload = value => JSON.stringify([value.history.records.slice().sort((a,b)=>a.id.localeCompare(b.id)),value.customSpreads,value.draft,value.settings]);
          return {exact:equalPayload(target)===equalPayload(second),count:second.history.records.length, templates:second.customSpreads.items.length,
            schemas:second.history.records.map(r=>r.schemaVersion).sort().join(','),
            draft:second.draft!==null, rejected, stable:equalPayload(first)===equalPayload(second)&&equalPayload(second)===equalPayload(after)};
        } finally { await api.importBackup(original); }
        """)
        XCTAssertEqual(result["count"] as? Int, 3)
        XCTAssertEqual(result["schemas"] as? String, "1,2,3")
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
        let started = ProcessInfo.processInfo.systemUptime
        var lastState: [String: Any] = [:]
        var lastError = "none"
        while ProcessInfo.processInfo.systemUptime - started < 30 {
            if !web.isLoading && web.accessibilityValue == "main-ready" {
                let result = await readinessProbe()
                switch result {
                case .success(let value):
                    lastState = value as? [String: Any] ?? [:]
                    if lastState["backup"] as? String == "fulfilled",
                       lastState["native"] as? String == "fulfilled",
                       (!requireNewDocument || lastState["oldDocument"] as? Bool == false) { return }
                case .failure(let error):
                    let safeError = error as NSError
                    lastError = "\(safeError.domain):\(safeError.code)"
                }
            }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTFail("WebKit readiness failed: elapsed=\(Int(ProcessInfo.processInfo.systemUptime - started)); loading=\(web.isLoading); progress=\(web.estimatedProgress); mainReady=\(web.accessibilityValue == "main-ready"); localEntry=\(web.url?.absoluteString == "quareia-app://app/index.html"); newDocumentRequired=\(requireNewDocument); phases=\(lastState); error=\(lastError)")
        throw NSError(domain: "WebBackupIntegrationTests", code: 1)
    }

    private func readinessProbe() async -> Result<Any, Error> {
        await withCheckedContinuation { continuation in
            var completed = false
            let finish: (Result<Any, Error>) -> Void = { result in
                guard !completed else { return }
                completed = true
                continuation.resume(returning: result)
            }
            web.callAsyncJavaScript("""
            if (!window.iosReadinessState) window.iosReadinessState={native:'missing',backup:'missing'};
            const state=window.iosReadinessState;
            function watch(key,api) {
              if(state[key]==='missing' && api && api.ready) {
                state[key]='pending';
                Promise.resolve(api.ready).then(()=>state[key]='fulfilled',()=>state[key]='rejected');
              }
            }
            watch('native',window.QuareiaIOS);watch('backup',window.DivinationBackup);
            return {native:state.native,backup:state.backup,document:document.readyState,
              oldDocument:!!window.iosOldDocument,bridge:!!window.QuareiaNative,
              initializationAlert:!!document.getElementById('iosHostInitializationAlert')};
            """, arguments: [:], in: nil, in: .page, completionHandler: finish)
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                finish(.failure(NSError(domain: "WebBackupReadinessProbeTimeout", code: 1)))
            }
        }
    }

    private func script(_ source: String) async throws -> [String: Any] {
        let result = try await web.callAsyncJavaScript(source, arguments: [:], in: nil, contentWorld: .page)
        return try XCTUnwrap(result as? [String: Any])
    }
}
