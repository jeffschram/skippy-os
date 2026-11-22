// skippy-imessage-export
//
// Reads recent messages from the Messages database on this Mac and writes
// them as a plain transcript for Skippy's ingestion pass to read. It opens the
// database read-only, changes nothing, and sends nothing anywhere: its only
// output is one file on this Mac.
//
// It exists so that reading Messages needs Full Disk Access for this one
// small program, and not for the Claude app, which reads untrusted mail.
//
//   skippy-imessage-export [--days N] [--db PATH] [--out PATH]
//
// Defaults: the last 3 days, ~/Library/Messages/chat.db, and
// ~/.skippy-os/imessage/recent.txt.

import Foundation
import SQLite3

let home = FileManager.default.homeDirectoryForCurrentUser.path
var days = 3
var dbPath = "\(home)/Library/Messages/chat.db"
var outPath = "\(home)/.skippy-os/imessage/recent.txt"

func fail(_ message: String) -> Never {
  FileHandle.standardError.write("skippy-imessage-export: \(message)\n".data(using: .utf8)!)
  exit(1)
}

var arguments = Array(CommandLine.arguments.dropFirst())
while !arguments.isEmpty {
  let flag = arguments.removeFirst()
  guard !arguments.isEmpty else { fail("\(flag) needs a value") }
  let value = arguments.removeFirst()
  switch flag {
  case "--days":
    guard let number = Int(value), number >= 1, number <= 60 else { fail("--days takes a whole number from 1 to 60") }
    days = number
  case "--db": dbPath = value
  case "--out": outPath = value
  default: fail("unknown option \(flag)")
  }
}

/// Seconds between 1970 and 2001, where the Messages clock starts.
let appleEpoch = 978_307_200.0

/// A Messages date as seconds since 1970. Newer databases count nanoseconds, older ones seconds.
func unixSeconds(_ raw: Int64) -> Double {
  let seconds = raw > 100_000_000_000 ? Double(raw) / 1_000_000_000 : Double(raw)
  return seconds + appleEpoch
}

/// The text inside an `attributedBody` blob. Since macOS Ventura many rows keep
/// their words only there. This finds the embedded NSString and reads its
/// length-prefixed bytes; anything unexpected gives nil.
func decodeAttributedBody(_ bytes: [UInt8]) -> String? {
  let marker = Array("NSString".utf8)
  guard bytes.count > marker.count else { return nil }
  var found = -1
  var index = 0
  while index + marker.count <= bytes.count {
    if Array(bytes[index..<(index + marker.count)]) == marker {
      found = index
      break
    }
    index += 1
  }
  guard found >= 0 else { return nil }
  let scanStart = found + marker.count
  let scanEnd = min(bytes.count, scanStart + 12)
  guard scanStart < scanEnd, let plus = bytes[scanStart..<scanEnd].firstIndex(of: 0x2B) else { return nil }
  var cursor = plus + 1
  guard cursor < bytes.count else { return nil }
  var length = Int(bytes[cursor])
  if bytes[cursor] == 0x81 {
    guard cursor + 2 < bytes.count else { return nil }
    length = Int(bytes[cursor + 1]) | (Int(bytes[cursor + 2]) << 8)
    cursor += 3
  } else if bytes[cursor] == 0x82 {
    guard cursor + 4 < bytes.count else { return nil }
    length = Int(bytes[cursor + 1]) | (Int(bytes[cursor + 2]) << 8) | (Int(bytes[cursor + 3]) << 16) | (Int(bytes[cursor + 4]) << 24)
    cursor += 5
  } else {
    cursor += 1
  }
  guard length > 0, cursor + length <= bytes.count else { return nil }
  return String(bytes: bytes[cursor..<(cursor + length)], encoding: .utf8)
}

struct Message {
  let guid: String
  let at: Double
  let fromMe: Bool
  let sender: String
  let text: String
  let hasAttachment: Bool
}

struct Chat {
  var title: String
  var isGroup: Bool
  var people: String
  var messages: [Message] = []
}

var db: OpaquePointer?
// Read-only, and never creating the file: this program must not be able to change Messages.
guard sqlite3_open_v2(dbPath, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
  let reason = db.flatMap { String(cString: sqlite3_errmsg($0)) } ?? "unknown"
  fail(
    "could not open \(dbPath): \(reason). If this is the real Messages database, this program needs Full Disk Access: System Settings, Privacy & Security, Full Disk Access.")
}
defer { sqlite3_close(db) }
sqlite3_busy_timeout(db, 5000)

let since = Date().timeIntervalSince1970 - Double(days) * 86_400
// Both clocks, so the same query serves old and new databases.
let sinceNanoseconds = Int64((since - appleEpoch) * 1_000_000_000)
let sinceSeconds = Int64(since - appleEpoch)

let query = """
  SELECT m.guid, m.date, m.is_from_me, COALESCE(h.id, ''), m.text, m.attributedBody,
         COALESCE(m.cache_has_attachments, 0), COALESCE(c.ROWID, 0), COALESCE(c.chat_identifier, ''),
         COALESCE(c.display_name, ''), COALESCE(c.style, 45),
         (SELECT group_concat(h2.id, ', ') FROM chat_handle_join j JOIN handle h2 ON h2.ROWID = j.handle_id WHERE j.chat_id = c.ROWID)
  FROM message m
  LEFT JOIN handle h ON h.ROWID = m.handle_id
  LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
  LEFT JOIN chat c ON c.ROWID = cmj.chat_id
  WHERE ((m.date > 100000000000 AND m.date >= ?1) OR (m.date <= 100000000000 AND m.date >= ?2))
    AND COALESCE(m.associated_message_type, 0) = 0
    AND COALESCE(m.item_type, 0) = 0
  ORDER BY m.date ASC
  LIMIT 5000
  """
var statement: OpaquePointer?
guard sqlite3_prepare_v2(db, query, -1, &statement, nil) == SQLITE_OK else {
  fail("could not read the messages: \(String(cString: sqlite3_errmsg(db)))")
}
defer { sqlite3_finalize(statement) }
sqlite3_bind_int64(statement, 1, sinceNanoseconds)
sqlite3_bind_int64(statement, 2, sinceSeconds)

func column(_ index: Int32) -> String {
  sqlite3_column_text(statement, index).map { String(cString: $0) } ?? ""
}

var chats: [Int64: Chat] = [:]
var order: [Int64] = []
var total = 0
while sqlite3_step(statement) == SQLITE_ROW {
  var text = column(4)
  if text.isEmpty, let blob = sqlite3_column_blob(statement, 5) {
    let count = Int(sqlite3_column_bytes(statement, 5))
    let bytes = Array(UnsafeBufferPointer(start: blob.assumingMemoryBound(to: UInt8.self), count: count))
    text = decodeAttributedBody(bytes) ?? ""
  }
  // The object-replacement character stands for an attachment inside the text.
  text = text.replacingOccurrences(of: "\u{FFFC}", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
  let hasAttachment = sqlite3_column_int(statement, 6) != 0
  if text.isEmpty && !hasAttachment { continue }
  let chatId = sqlite3_column_int64(statement, 7)
  if chats[chatId] == nil {
    let name = column(9)
    let people = column(11)
    chats[chatId] = Chat(
      title: name.isEmpty ? column(8) : name,
      isGroup: sqlite3_column_int(statement, 10) == 43,
      people: people)
    order.append(chatId)
  }
  // One message is one line: long ones are cut, and line breaks become spaces.
  var line = text.replacingOccurrences(of: "\n", with: " ").replacingOccurrences(of: "\r", with: " ")
  if line.count > 600 { line = String(line.prefix(600)) + "…" }
  chats[chatId]!.messages.append(
    Message(
      guid: column(0), at: unixSeconds(sqlite3_column_int64(statement, 1)), fromMe: sqlite3_column_int(statement, 2) != 0,
      sender: column(3), text: line, hasAttachment: hasAttachment))
  total += 1
}

let stamp = ISO8601DateFormatter()
stamp.formatOptions = [.withInternetDateTime]
var lines: [String] = []
lines.append("# Messages on this Mac, exported \(stamp.string(from: Date()))")
lines.append("# Covers \(stamp.string(from: Date(timeIntervalSince1970: since))) to now: \(total) messages in \(order.count) conversations.")
lines.append("# Each line: [time] who id=<message id>: text. \"me\" is the owner of this Mac.")
for chatId in order {
  guard let chat = chats[chatId] else { continue }
  lines.append("")
  let kind = chat.isGroup ? "group" : "direct"
  let people = chat.people.isEmpty ? "" : " with \(chat.people)"
  lines.append("## \(kind) conversation \"\(chat.title)\"\(people)")
  for message in chat.messages {
    let who = message.fromMe ? "me" : (message.sender.isEmpty ? "them" : message.sender)
    let body = message.text.isEmpty ? "(attachment, no text)" : message.text + (message.hasAttachment ? " (with attachment)" : "")
    lines.append("[\(stamp.string(from: Date(timeIntervalSince1970: message.at)))] \(who) id=\(message.guid): \(body)")
  }
}

let outURL = URL(fileURLWithPath: outPath)
do {
  try FileManager.default.createDirectory(at: outURL.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
  // Written whole, then moved into place, so a reader never sees half a file.
  let temporary = outURL.deletingLastPathComponent().appendingPathComponent(".recent-\(ProcessInfo.processInfo.processIdentifier).tmp")
  try (lines.joined(separator: "\n") + "\n").write(to: temporary, atomically: false, encoding: .utf8)
  try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: temporary.path)
  _ = try FileManager.default.replaceItemAt(outURL, withItemAt: temporary)
} catch {
  fail("could not write \(outPath): \(error.localizedDescription)")
}
print("Wrote \(total) messages from \(order.count) conversations to \(outPath)")
