import Foundation
import XCTest
@testable import Quareia

final class ServicesTransportTests: XCTestCase {
    override func tearDown() {
        ServicesStubURLProtocol.handler = nil
        super.tearDown()
    }

    func testInjectedURLSessionConfigurationProvidesDeterministicTransport() async throws {
        ServicesStubURLProtocol.handler = { request in
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: ["ETag": "\"fixture\""]
            )!
            return (response, Data("fixture".utf8))
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ServicesStubURLProtocol.self]
        let client = URLSessionHTTPClient(configuration: configuration)
        let request = URLRequest(url: URL(string: "https://services.example/fixture")!)

        let response = try await client.data(
            for: request,
            owner: UUID(),
            maximumBytes: 64,
            redirectValidator: { $0.host == "services.example" }
        )
        XCTAssertEqual(response.statusCode, 200)
        XCTAssertEqual(response.headers["etag"], "\"fixture\"")
        XCTAssertEqual(response.data, Data("fixture".utf8))
    }

    func testStreamingDataPathCancelsAsSoonAsBoundIsExceeded() async {
        ServicesStubURLProtocol.handler = { request in
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: nil
            )!
            return (response, Data("too large".utf8))
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ServicesStubURLProtocol.self]
        let client = URLSessionHTTPClient(configuration: configuration)
        let request = URLRequest(url: URL(string: "https://services.example/fixture")!)

        do {
            _ = try await client.data(
                for: request,
                owner: UUID(),
                maximumBytes: 3,
                redirectValidator: { _ in true }
            )
            XCTFail("oversized response should fail")
        } catch let error as ServiceHTTPError {
            XCTAssertEqual(error, .responseTooLarge)
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }
}

private final class ServicesStubURLProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.handler else {
            client?.urlProtocol(self, didFailWithError: ServiceHTTPError.transport)
            return
        }
        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
