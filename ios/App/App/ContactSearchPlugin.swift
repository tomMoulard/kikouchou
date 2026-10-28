import Capacitor
import Contacts

/// Finds the contacts whose name matches what the user types in a guest's
/// name field, with their phone numbers.
///
/// Read-only on purpose: it returns names and numbers only. The web side is
/// src/lib/contacts/contact-search.ts.
@objc(ContactSearchPlugin)
public class ContactSearchPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ContactSearchPlugin"
    public let jsName = "ContactSearch"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "search", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
    ]

    /// The most contacts one search may return, whatever the page asks.
    private static let maxLimit = 20

    private let store = CNContactStore()

    @objc override public func checkPermissions(_ call: CAPPluginCall) {
        call.resolve(["contacts": Self.permissionState()])
    }

    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        store.requestAccess(for: .contacts) { _, _ in
            call.resolve(["contacts": Self.permissionState()])
        }
    }

    @objc func search(_ call: CAPPluginCall) {
        guard Self.canRead() else {
            call.reject("Contacts permission not granted")
            return
        }

        let query = (call.getString("query") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let limit = max(1, min(Self.maxLimit, call.getInt("limit") ?? 8))
        if query.isEmpty {
            call.resolve(["contacts": []])
            return
        }

        // The fetch blocks, so it stays off the main thread.
        DispatchQueue.global(qos: .userInitiated).async { [store] in
            let keys: [CNKeyDescriptor] = [
                CNContactFormatter.descriptorForRequiredKeys(for: .fullName),
                CNContactPhoneNumbersKey as CNKeyDescriptor,
            ]
            do {
                let found = try store.unifiedContacts(
                    matching: CNContact.predicateForContacts(matchingName: query),
                    keysToFetch: keys
                )
                var contacts: [[String: Any]] = []
                for contact in found {
                    guard let name = CNContactFormatter.string(from: contact, style: .fullName),
                          !name.trimmingCharacters(in: .whitespaces).isEmpty else {
                        continue
                    }
                    let phones = contact.phoneNumbers.map { $0.value.stringValue }
                    contacts.append(["name": name, "phones": phones])
                    if contacts.count >= limit {
                        break
                    }
                }
                call.resolve(["contacts": contacts])
            } catch {
                call.reject("Could not read the contacts", nil, error)
            }
        }
    }

    private static func canRead() -> Bool {
        let state = permissionState()
        return state == "granted" || state == "limited"
    }

    private static func permissionState() -> String {
        switch CNContactStore.authorizationStatus(for: .contacts) {
        case .authorized:
            return "granted"
        case .notDetermined:
            return "prompt"
        case .denied, .restricted:
            return "denied"
        default:
            // iOS 18's `.limited`: the user shared some contacts, and the
            // search sees those.
            return "limited"
        }
    }
}
