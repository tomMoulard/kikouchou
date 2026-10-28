package app.kikouchou;

import android.Manifest;
import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Finds the contacts whose name matches what the user types in a guest's
 * name field, with their phone numbers.
 *
 * Read-only on purpose: it asks for READ_CONTACTS and nothing else, and it
 * returns names and numbers only. The web side is
 * src/lib/contacts/contact-search.ts.
 */
@CapacitorPlugin(
    name = "ContactSearch",
    permissions = { @Permission(strings = { Manifest.permission.READ_CONTACTS }, alias = ContactSearchPlugin.CONTACTS) }
)
public class ContactSearchPlugin extends Plugin {

    static final String CONTACTS = "contacts";

    /** The most contacts one search may return, whatever the page asks. */
    private static final int MAX_LIMIT = 20;

    @PluginMethod
    public void search(PluginCall call) {
        if (getPermissionState(CONTACTS) != PermissionState.GRANTED) {
            call.reject("Contacts permission not granted");
            return;
        }

        String query = call.getString("query", "").trim();
        int limit = Math.max(1, Math.min(MAX_LIMIT, call.getInt("limit", 8)));
        if (query.isEmpty()) {
            call.resolve(result(new JSArray()));
            return;
        }

        try {
            call.resolve(result(find(query, limit)));
        } catch (Exception error) {
            call.reject("Could not read the contacts", error);
        }
    }

    private JSArray find(String query, int limit) {
        ContentResolver resolver = getContext().getContentResolver();

        // The provider's own name filter: it matches the start of any word of
        // the display name, the way the phone's Contacts app searches.
        Uri uri = Uri.withAppendedPath(ContactsContract.Contacts.CONTENT_FILTER_URI, Uri.encode(query));
        String[] projection = {
            ContactsContract.Contacts._ID,
            ContactsContract.Contacts.DISPLAY_NAME_PRIMARY,
            ContactsContract.Contacts.HAS_PHONE_NUMBER,
        };

        Map<Long, String> names = new LinkedHashMap<>();
        List<Long> withPhones = new ArrayList<>();
        try (Cursor cursor = resolver.query(uri, projection, null, null, ContactsContract.Contacts.SORT_KEY_PRIMARY)) {
            if (cursor != null) {
                while (cursor.moveToNext() && names.size() < limit) {
                    long id = cursor.getLong(0);
                    String name = cursor.getString(1);
                    if (name == null || name.trim().isEmpty()) {
                        continue;
                    }
                    names.put(id, name);
                    if (cursor.getInt(2) > 0) {
                        withPhones.add(id);
                    }
                }
            }
        }

        Map<Long, List<String>> phones = phonesOf(resolver, withPhones);

        JSArray contacts = new JSArray();
        for (Map.Entry<Long, String> entry : names.entrySet()) {
            JSObject contact = new JSObject();
            contact.put("name", entry.getValue());
            JSArray numbers = new JSArray();
            List<String> found = phones.get(entry.getKey());
            if (found != null) {
                for (String number : found) {
                    numbers.put(number);
                }
            }
            contact.put("phones", numbers);
            contacts.put(contact);
        }
        return contacts;
    }

    private Map<Long, List<String>> phonesOf(ContentResolver resolver, List<Long> ids) {
        Map<Long, List<String>> phones = new LinkedHashMap<>();
        if (ids.isEmpty()) {
            return phones;
        }

        StringBuilder selection = new StringBuilder(ContactsContract.CommonDataKinds.Phone.CONTACT_ID + " IN (");
        String[] args = new String[ids.size()];
        for (int i = 0; i < ids.size(); i++) {
            selection.append(i == 0 ? "?" : ",?");
            args[i] = String.valueOf(ids.get(i));
        }
        selection.append(')');

        String[] projection = {
            ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
            ContactsContract.CommonDataKinds.Phone.NUMBER,
        };
        // The number the user marked as the default comes first.
        String order = ContactsContract.CommonDataKinds.Phone.IS_SUPER_PRIMARY + " DESC, "
            + ContactsContract.CommonDataKinds.Phone.IS_PRIMARY + " DESC";

        try (Cursor cursor = resolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI, projection, selection.toString(), args, order)) {
            if (cursor != null) {
                while (cursor.moveToNext()) {
                    String number = cursor.getString(1);
                    if (number == null || number.trim().isEmpty()) {
                        continue;
                    }
                    long id = cursor.getLong(0);
                    List<String> list = phones.get(id);
                    if (list == null) {
                        list = new ArrayList<>();
                        phones.put(id, list);
                    }
                    list.add(number);
                }
            }
        }
        return phones;
    }

    private static JSObject result(JSArray contacts) {
        JSObject result = new JSObject();
        result.put("contacts", contacts);
        return result;
    }
}
