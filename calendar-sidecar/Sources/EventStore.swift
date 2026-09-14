import CoreLocation
import EventKit
import Foundation

// MARK: - Constants

private let SYNC_WINDOW_PAST_DAYS = 7
private let SYNC_WINDOW_FUTURE_DAYS = 60
private let LEGACY_CALENDAR_TITLE = "Zenborg"

// MARK: - Lock

private func acquireLock() -> Int32? {
    let lockPath = vaultRoot().appendingPathComponent(".calendar-sidecar.lock").path
    let fd = open(lockPath, O_CREAT | O_RDWR, 0o644)
    guard fd >= 0 else { return nil }
    if flock(fd, LOCK_EX | LOCK_NB) != 0 {
        close(fd)
        return nil
    }
    return fd
}

// MARK: - Status

func printStatus() {
    let store = EKEventStore()
    let auth = EKEventStore.authorizationStatus(for: .event)
    let authString: String
    switch auth {
    case .fullAccess: authString = "fullAccess"
    case .denied, .restricted: authString = "denied"
    case .notDetermined: authString = "notDetermined"
    case .writeOnly: authString = "writeOnly"
    @unknown default: authString = "unknown"
    }

    var calendars: [[String: String]] = []
    if auth == .fullAccess || auth == .writeOnly {
        for cal in store.calendars(for: .event) {
            calendars.append([
                "id": cal.calendarIdentifier,
                "title": cal.title,
                "source": cal.source?.title ?? "unknown",
            ])
        }
    }

    let config = readCalendarSyncConfig()
    let result: [String: Any] = [
        "authorization": authString,
        "calendars": calendars,
        "areaCalendars": config.areaCalendars,
        "selectedCalendarIds": config.selectedCalendarIds,
    ]

    if let data = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]) {
        print(String(data: data, encoding: .utf8)!)
    }
}

// MARK: - Reconcile once

func reconcileOnce() {
    guard let lockFd = acquireLock() else {
        fputs("[calendar] another instance holds the lock; exiting\n", stderr)
        return
    }
    defer { close(lockFd) }

    let store = EKEventStore()
    guard requestAccess(store: store) else {
        fputs("[calendar] access denied; dormant\n", stderr)
        return
    }

    doReconcilePass(store: store)
}

// MARK: - Watch loop

func runWatchLoop() {
    guard let lockFd = acquireLock() else {
        fputs("[calendar] another instance holds the lock; exiting\n", stderr)
        return
    }

    let store = EKEventStore()
    guard requestAccess(store: store) else {
        fputs("[calendar] access denied; dormant\n", stderr)
        // Keep running but idle so the app does not respawn us
        RunLoop.current.run()
        close(lockFd)
        return
    }

    // Initial reconcile
    doReconcilePass(store: store)

    // Watch for changes
    let center = NotificationCenter.default
    center.addObserver(
        forName: .EKEventStoreChanged,
        object: store,
        queue: .main
    ) { _ in
        fputs("[calendar] event store changed; reconciling\n", stderr)
        doReconcilePass(store: store)
    }

    fputs("[calendar] watching for changes\n", stderr)

    // Keep the process alive
    signal(SIGTERM) { _ in exit(0) }
    signal(SIGINT) { _ in exit(0) }
    RunLoop.current.run()
    close(lockFd)
}

// MARK: - Access request

private func requestAccess(store: EKEventStore) -> Bool {
    let status = EKEventStore.authorizationStatus(for: .event)
    fputs("[calendar] authorization status: \(status.rawValue)\n", stderr)
    switch status {
    case .fullAccess:
        return true
    case .writeOnly:
        var upgraded = false
        let semaphore = DispatchSemaphore(value: 0)
        store.requestFullAccessToEvents { success, error in
            upgraded = success
            if let error = error {
                fputs("[calendar] full access request error: \(error)\n", stderr)
            }
            semaphore.signal()
        }
        semaphore.wait()
        if upgraded {
            fputs("[calendar] upgraded to full access\n", stderr)
            return true
        }
        fputs("[calendar] running with write-only access (publish only, no ingest)\n", stderr)
        return true
    case .notDetermined:
        var granted = false
        let semaphore = DispatchSemaphore(value: 0)
        store.requestFullAccessToEvents { success, error in
            granted = success
            if let error = error {
                fputs("[calendar] access request error: \(error)\n", stderr)
            }
            semaphore.signal()
        }
        semaphore.wait()
        return granted
    default:
        fputs("[calendar] access denied (status \(status.rawValue))\n", stderr)
        return false
    }
}

// MARK: - The reconcile pass

private func doReconcilePass(store: EKEventStore) {
    do {
        var config = readCalendarSyncConfig()
        var moments = try readMoments()
        let phaseConfigs = readPhaseConfigs()
        let areas = readAreas()
        let habits = readHabits()
        let people = readPeople()
        let places = readPlaces()

        // Collect the set of area IDs that have publishable moments
        // (includes ambient allocated moments for all-day events)
        var areaIdsNeeded: Set<String> = []
        for (_, moment) in moments {
            if moment.day != nil && countsAsAllocation(moment) {
                areaIdsNeeded.insert(moment.areaId)
            }
        }

        // Ensure area calendars exist for needed areas; update name/color if drifted
        for areaId in areaIdsNeeded {
            _ = ensureAreaCalendar(store: store, config: &config, areaId: areaId, areas: areas)
        }

        // Drop area-calendar entries for areas no longer in the vault (deleted/archived)
        // and delete their macOS calendars
        var removedAreaIds: [String] = []
        for (areaId, calId) in config.areaCalendars {
            if areas[areaId] == nil {
                removedAreaIds.append(areaId)
                if let cal = store.calendar(withIdentifier: calId) {
                    do {
                        try store.removeCalendar(cal, commit: true)
                        fputs("[calendar] removed calendar for deleted area '\(areaId)'\n", stderr)
                    } catch {
                        fputs("[calendar] failed to remove calendar for deleted area '\(areaId)': \(error)\n", stderr)
                    }
                }
            } else if store.calendar(withIdentifier: calId) == nil {
                removedAreaIds.append(areaId)
                fputs("[calendar] area calendar for '\(areaId)' was deleted; dropping stale refs\n", stderr)
            }
        }
        if !removedAreaIds.isEmpty {
            let staleCalIds = Set(removedAreaIds.compactMap { config.areaCalendars[$0] })
            for areaId in removedAreaIds {
                config.areaCalendars.removeValue(forKey: areaId)
            }
            try writeCalendarSyncConfig(config)
            for (id, var moment) in moments {
                if let ref = moment.externalRef, staleCalIds.contains(ref.calendarId) {
                    moment.externalRef = nil
                    moment.updatedAt = iso8601Now()
                    moments[id] = moment
                }
            }
        }

        let areaCalendarIdSet = Set(config.areaCalendars.values)
        let managedSet = Set(config.managedEventIds)
        let context = ReconcileContext(
            areaCalendarIds: areaCalendarIdSet,
            selectedCalendarIds: config.selectedCalendarIds,
            managedEventIds: managedSet
        )

        // Compute the sync window
        let now = Date()
        let calendar = Calendar.current
        let windowStart = calendar.date(byAdding: .day, value: -SYNC_WINDOW_PAST_DAYS, to: now)!
        let windowEnd = calendar.date(byAdding: .day, value: SYNC_WINDOW_FUTURE_DAYS, to: now)!

        let windowStartDay = dayString(from: windowStart)
        let windowEndDay = dayString(from: windowEnd)

        // Fetch events in the sync window
        let allCalendarIds = areaCalendarIdSet.union(config.selectedCalendarIds)
        let allCalendars = store.calendars(for: .event).filter { allCalendarIds.contains($0.calendarIdentifier) }

        let predicate = store.predicateForEvents(withStart: windowStart, end: windowEnd, calendars: allCalendars.isEmpty ? nil : allCalendars)
        let ekEvents = store.events(matching: predicate)

        // Build event snapshots
        var eventSnapshots: [String: EventSnapshot] = [:]
        for ekEvent in ekEvents {
            let snapshot = eventSnapshotFrom(ekEvent)
            eventSnapshots[snapshot.eventId] = snapshot
        }

        // Partition moments by sync window
        var inWindowMoments: [String: VaultMoment] = [:]

        for (id, moment) in moments {
            guard let day = moment.day else {
                if moment.externalRef != nil {
                    inWindowMoments[id] = moment
                }
                continue
            }
            if day >= windowStartDay && day <= windowEndDay {
                inWindowMoments[id] = moment
            }
        }

        // For in-window moments with externalRef but no fetched event,
        // confirm absence with a direct lookup (window-independent)
        for (_, moment) in inWindowMoments {
            guard let ref = moment.externalRef else { continue }
            if eventSnapshots[ref.eventId] != nil { continue }

            if let ekEvent = store.event(withIdentifier: ref.eventId) {
                let snapshot = eventSnapshotFrom(ekEvent)
                eventSnapshots[snapshot.eventId] = snapshot
            }
        }

        // Pair and reconcile
        var actions: [(ReconcileAction, String?)] = []
        var processedEventIds: Set<String> = []

        for (id, moment) in inWindowMoments {
            let event: EventSnapshot?
            if let ref = moment.externalRef {
                event = eventSnapshots[ref.eventId]
                if let eid = event?.eventId { processedEventIds.insert(eid) }
            } else {
                event = nil
            }

            let action = reconcile(moment: moment, event: event, context: context)
            if case .none = action { continue }
            actions.append((action, id))
        }

        for (eventId, event) in eventSnapshots where !processedEventIds.contains(eventId) {
            let action = reconcile(moment: nil, event: event, context: context)
            if case .none = action { continue }
            actions.append((action, nil))
        }

        // Apply actions
        var changed = false
        var configChanged = false
        for (action, _) in actions {
            switch action {
            case .publishEvent(let momentId, let overwroteEventEdit):
                if let moment = moments[momentId],
                   let fields = eventFieldsForMoment(moment) {
                    let calId = ensureAreaCalendar(store: store, config: &config, areaId: moment.areaId, areas: areas)
                    guard let targetCalId = calId else { continue }
                    let emoji = resolveEmoji(moment: moment, habits: habits, areas: areas)
                    let title = emoji != nil ? "\(emoji!) \(fields.title)" : fields.title
                    let isAllDay = fields.startTime == nil
                    let tz = resolveTimezone(moment: moment, habits: habits)
                    let (loc, structLoc) = resolveLocation(moment: moment, places: places)
                    let notes = resolveNotes(moment: moment, people: people)
                    if let ekEvent = createOrUpdateEvent(
                        store: store,
                        calendarId: targetCalId,
                        existingEventId: moment.externalRef?.eventId,
                        title: title,
                        day: fields.day,
                        startTime: fields.startTime,
                        durationMin: fields.durationMin,
                        isAllDay: isAllDay,
                        timezone: tz,
                        location: loc,
                        structuredLocation: structLoc,
                        notes: notes
                    ) {
                        var updated = moment
                        let hash = momentHash(day: fields.day, startTime: fields.startTime, durationMin: fields.durationMin)
                        updated.externalRef = ExternalRef(
                            source: "eventkit",
                            eventId: ekEvent.eventIdentifier,
                            calendarId: targetCalId,
                            lastWrittenHash: hash,
                            lastWrittenTitle: fields.title,
                            lastSyncedAt: iso8601Now()
                        )
                        updated.updatedAt = iso8601Now()
                        moments[momentId] = updated
                        changed = true
                        if !config.managedEventIds.contains(ekEvent.eventIdentifier) {
                            config.managedEventIds.append(ekEvent.eventIdentifier)
                            configChanged = true
                        }
                        if overwroteEventEdit {
                            fputs("[calendar] overwrote event edit for moment \(momentId) (moment was newer)\n", stderr)
                        }
                    }
                }

            case .createTentativeMoment(let name, let day, let startTime, let durationMin, let eventId, let eventCalendarId):
                let newId = UUID().uuidString.lowercased()
                let hash = momentHash(day: day, startTime: startTime, durationMin: durationMin)
                let configs = readPhaseConfigs()
                let phase: String? = startTime != nil ? phaseForStartTime(startTime!, configs) : nil
                let newMoment = VaultMoment(
                    id: newId,
                    name: name,
                    areaId: "pending",
                    habitId: nil,
                    phase: phase,
                    day: day,
                    startTime: startTime,
                    durationMin: durationMin,
                    status: "tentative",
                    personIds: [],
                    placeIds: [],
                    externalRef: ExternalRef(
                        source: "eventkit",
                        eventId: eventId,
                        calendarId: eventCalendarId,
                        lastWrittenHash: hash,
                        lastWrittenTitle: name,
                        lastSyncedAt: iso8601Now()
                    ),
                    updatedAt: iso8601Now(),
                    raw: [
                        "id": newId,
                        "name": name,
                        "areaId": "pending",
                        "habitId": NSNull(),
                        "cycleId": NSNull(),
                        "cyclePlanId": NSNull(),
                        "phase": phase as Any,
                        "day": day,
                        "order": 0,
                        "startTime": startTime as Any,
                        "durationMin": durationMin as Any,
                        "status": "tentative",
                        "personIds": [String](),
                        "placeIds": [String](),
                        "tags": NSNull(),
                        "createdAt": iso8601Now(),
                        "updatedAt": iso8601Now(),
                    ]
                )
                moments[newId] = newMoment
                changed = true
                fputs("[calendar] ingested tentative moment '\(name)' from \(eventCalendarId)\n", stderr)

            case .createMomentFromAreaEvent(let name, let day, let startTime, let durationMin, let eventId, let eventCalendarId):
                let areaId = config.areaCalendars.first(where: { $0.value == eventCalendarId })?.key ?? "pending"
                let newId = UUID().uuidString.lowercased()
                let hash = momentHash(day: day, startTime: startTime, durationMin: durationMin)
                let configs = readPhaseConfigs()
                let phase: String? = startTime != nil ? phaseForStartTime(startTime!, configs) : nil
                let newMoment = VaultMoment(
                    id: newId,
                    name: name,
                    areaId: areaId,
                    habitId: nil,
                    phase: phase,
                    day: day,
                    startTime: startTime,
                    durationMin: durationMin,
                    status: nil,
                    personIds: [],
                    placeIds: [],
                    externalRef: ExternalRef(
                        source: "eventkit",
                        eventId: eventId,
                        calendarId: eventCalendarId,
                        lastWrittenHash: hash,
                        lastWrittenTitle: name,
                        lastSyncedAt: iso8601Now()
                    ),
                    updatedAt: iso8601Now(),
                    raw: [
                        "id": newId,
                        "name": name,
                        "areaId": areaId,
                        "habitId": NSNull(),
                        "cycleId": NSNull(),
                        "cyclePlanId": NSNull(),
                        "phase": phase as Any,
                        "day": day,
                        "order": 0,
                        "startTime": startTime as Any,
                        "durationMin": durationMin as Any,
                        "personIds": [String](),
                        "placeIds": [String](),
                        "tags": NSNull(),
                        "createdAt": iso8601Now(),
                        "updatedAt": iso8601Now(),
                    ]
                )
                moments[newId] = newMoment
                changed = true
                if !config.managedEventIds.contains(eventId) {
                    config.managedEventIds.append(eventId)
                    configChanged = true
                }
                fputs("[calendar] created moment '\(name)' from area calendar event \(eventId)\n", stderr)

            case .applyEventToMoment(let momentId, let day, let startTime, let durationMin, let overwroteMomentEdit):
                if var moment = moments[momentId] {
                    moment.day = day
                    moment.startTime = startTime
                    moment.durationMin = durationMin
                    if let st = startTime {
                        moment.phase = phaseForStartTime(st, phaseConfigs)
                    }
                    let hash = momentHash(day: day, startTime: startTime, durationMin: durationMin)
                    if var ref = moment.externalRef {
                        ref.lastWrittenHash = hash
                        ref.lastSyncedAt = iso8601Now()
                        moment.externalRef = ref
                    }
                    moment.updatedAt = iso8601Now()
                    moments[momentId] = moment
                    changed = true
                    if overwroteMomentEdit {
                        fputs("[calendar] overwrote moment edit for \(momentId) (event was newer)\n", stderr)
                    }
                }

            case .deleteMoment(let momentId):
                moments.removeValue(forKey: momentId)
                changed = true
                fputs("[calendar] deleted tentative moment \(momentId)\n", stderr)

            case .returnToDrawingBoard(let momentId):
                if var moment = moments[momentId] {
                    moment.day = nil
                    moment.phase = nil
                    moment.externalRef = nil
                    moment.updatedAt = iso8601Now()
                    moments[momentId] = moment
                    changed = true
                    fputs("[calendar] returned moment \(momentId) to drawing board\n", stderr)
                }

            case .deleteEvent(let eventId):
                if let ekEvent = store.event(withIdentifier: eventId) {
                    do {
                        try store.remove(ekEvent, span: .thisEvent)
                        fputs("[calendar] deleted event \(eventId)\n", stderr)
                    } catch {
                        fputs("[calendar] failed to delete event \(eventId): \(error)\n", stderr)
                    }
                }
                if let idx = config.managedEventIds.firstIndex(of: eventId) {
                    config.managedEventIds.remove(at: idx)
                    configChanged = true
                }

            case .none:
                break
            }
        }

        if changed {
            try writeMoments(moments)
            fputs("[calendar] reconcile pass complete: \(actions.count) actions applied\n", stderr)
        } else {
            fputs("[calendar] reconcile pass complete: no changes\n", stderr)
        }

        if configChanged {
            try writeCalendarSyncConfig(config)
        }

    } catch {
        fputs("[calendar] reconcile failed: \(error)\n", stderr)
    }
}

// MARK: - EventKit helpers

@discardableResult
private func ensureAreaCalendar(
    store: EKEventStore,
    config: inout CalendarSyncConfig,
    areaId: String,
    areas: [String: VaultArea]
) -> String? {
    let area = areas[areaId]
    let title = area.map { "\($0.emoji) \($0.name)" } ?? areaId

    // Check if existing calendar id still resolves
    if let existingId = config.areaCalendars[areaId] {
        if let cal = store.calendar(withIdentifier: existingId) {
            // Update title/color if the area was renamed or recolored
            if cal.title != title {
                cal.title = title
                try? store.saveCalendar(cal, commit: true)
                fputs("[calendar] updated area calendar title to '\(title)'\n", stderr)
            }
            if let area = area, let cgColor = colorFromHex(area.color) {
                cal.cgColor = cgColor
            }
            return cal.calendarIdentifier
        }
        fputs("[calendar] area calendar for '\(title)' was deleted; will recover or recreate\n", stderr)
        config.areaCalendars.removeValue(forKey: areaId)
    }

    // Before creating, search for an existing calendar with the same title.
    // Prevents duplication when the config mapping is lost.
    let activeCalIds = Set(config.areaCalendars.values)
    if let existing = store.calendars(for: .event).first(where: {
        $0.title == title && !activeCalIds.contains($0.calendarIdentifier)
    }) {
        config.areaCalendars[areaId] = existing.calendarIdentifier
        try? writeCalendarSyncConfig(config)
        fputs("[calendar] adopted existing calendar '\(title)': \(existing.calendarIdentifier)\n", stderr)
        return existing.calendarIdentifier
    }

    // Create a new calendar for this area
    let newCal = EKCalendar(for: .event, eventStore: store)
    newCal.title = title
    if let area = area, let cgColor = colorFromHex(area.color) {
        newCal.cgColor = cgColor
    }

    if let defaultSource = store.defaultCalendarForNewEvents?.source {
        newCal.source = defaultSource
    } else if let localSource = store.sources.first(where: { $0.sourceType == .local }) {
        newCal.source = localSource
    } else {
        fputs("[calendar] no suitable calendar source found\n", stderr)
        return nil
    }

    do {
        try store.saveCalendar(newCal, commit: true)
        config.areaCalendars[areaId] = newCal.calendarIdentifier
        try writeCalendarSyncConfig(config)
        fputs("[calendar] created area calendar '\(title)': \(newCal.calendarIdentifier)\n", stderr)
        return newCal.calendarIdentifier
    } catch {
        fputs("[calendar] failed to create calendar for area '\(title)': \(error)\n", stderr)
        return nil
    }
}

private func resolveEmoji(moment: VaultMoment, habits: [String: (emoji: String?, areaId: String, timezone: String?)], areas: [String: VaultArea]) -> String? {
    if let momentEmoji = moment.raw["emoji"] as? String, !momentEmoji.isEmpty {
        return momentEmoji
    }
    if let habitId = moment.habitId, let habit = habits[habitId] {
        if let emoji = habit.emoji, !emoji.isEmpty { return emoji }
    }
    if let area = areas[moment.areaId] {
        if !area.emoji.isEmpty { return area.emoji }
    }
    return nil
}

private func resolveTimezone(moment: VaultMoment, habits: [String: (emoji: String?, areaId: String, timezone: String?)]) -> TimeZone? {
    guard let habitId = moment.habitId,
          let habit = habits[habitId],
          let tz = habit.timezone else { return nil }
    return TimeZone(identifier: tz)
}

private func resolveLocation(moment: VaultMoment, places: [String: VaultPlace]) -> (location: String?, structured: EKStructuredLocation?) {
    guard !moment.placeIds.isEmpty else { return (nil, nil) }
    let resolved = moment.placeIds.compactMap { key in
        places.values.first { $0.key == key }
    }
    guard let first = resolved.first else { return (nil, nil) }

    let locationString = first.address ?? first.name

    if let coords = first.coordinates {
        let sl = EKStructuredLocation(title: locationString)
        sl.geoLocation = CLLocation(latitude: coords.lat, longitude: coords.lng)
        return (locationString, sl)
    }

    return (locationString, nil)
}

private func resolveNotes(moment: VaultMoment, people: [String: VaultPerson]) -> String? {
    guard !moment.personIds.isEmpty else { return nil }
    let names = moment.personIds.compactMap { key in
        people.values.first(where: { $0.key == key })?.name
    }
    guard !names.isEmpty else { return nil }
    return "with \(names.joined(separator: ", "))"
}

private func colorFromHex(_ hex: String) -> CGColor? {
    var h = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if h.hasPrefix("#") { h = String(h.dropFirst()) }
    guard h.count == 6,
          let r = UInt8(h.prefix(2), radix: 16),
          let g = UInt8(h.dropFirst(2).prefix(2), radix: 16),
          let b = UInt8(h.dropFirst(4).prefix(2), radix: 16) else {
        return nil
    }
    return CGColor(
        srgbRed: CGFloat(r) / 255,
        green: CGFloat(g) / 255,
        blue: CGFloat(b) / 255,
        alpha: 1
    )
}

private func eventSnapshotFrom(_ ekEvent: EKEvent) -> EventSnapshot {
    // Always extract in the device's local timezone — moments store local
    // display time, so the snapshot must match that frame.
    let cal = Calendar.current
    let components = cal.dateComponents([.year, .month, .day, .hour, .minute], from: ekEvent.startDate)
    let day = String(format: "%04d-%02d-%02d", components.year!, components.month!, components.day!)

    if ekEvent.isAllDay {
        return EventSnapshot(
            eventId: ekEvent.eventIdentifier,
            calendarId: ekEvent.calendar.calendarIdentifier,
            title: ekEvent.title ?? "",
            day: day,
            startTime: "00:00",
            durationMin: 1440,
            isAllDay: true,
            lastModified: ekEvent.lastModifiedDate?.iso8601 ?? iso8601Now()
        )
    }

    let startTime = String(format: "%02d:%02d", components.hour!, components.minute!)
    let durationMin = Int(ekEvent.endDate.timeIntervalSince(ekEvent.startDate) / 60)

    return EventSnapshot(
        eventId: ekEvent.eventIdentifier,
        calendarId: ekEvent.calendar.calendarIdentifier,
        title: ekEvent.title ?? "",
        day: day,
        startTime: startTime,
        durationMin: max(durationMin, 15),
        isAllDay: false,
        lastModified: ekEvent.lastModifiedDate?.iso8601 ?? iso8601Now()
    )
}

private func createOrUpdateEvent(
    store: EKEventStore,
    calendarId: String,
    existingEventId: String?,
    title: String,
    day: String,
    startTime: String?,
    durationMin: Int?,
    isAllDay: Bool,
    timezone: TimeZone? = nil,
    location: String? = nil,
    structuredLocation: EKStructuredLocation? = nil,
    notes: String? = nil
) -> EKEvent? {
    let ekEvent: EKEvent
    if let existingId = existingEventId, let existing = store.event(withIdentifier: existingId) {
        ekEvent = existing
    } else {
        ekEvent = EKEvent(eventStore: store)
        guard let cal = store.calendar(withIdentifier: calendarId) else { return nil }
        ekEvent.calendar = cal
    }

    ekEvent.title = title
    ekEvent.timeZone = timezone
    ekEvent.location = location
    if let sl = structuredLocation {
        ekEvent.structuredLocation = sl
    }
    ekEvent.notes = notes

    let parts = day.split(separator: "-").map { Int($0)! }
    var components = DateComponents()
    components.year = parts[0]
    components.month = parts[1]
    components.day = parts[2]
    // Moment startTime is local display time — interpret in the device's
    // timezone so the absolute instant is correct. The event's timeZone
    // (set above) is display metadata only.
    let cal = Calendar.current

    if isAllDay {
        ekEvent.isAllDay = true
        guard let startDate = cal.date(from: components) else { return nil }
        ekEvent.startDate = startDate
        ekEvent.endDate = startDate
    } else {
        ekEvent.isAllDay = false
        let timeParts = startTime!.split(separator: ":").map { Int($0)! }
        components.hour = timeParts[0]
        components.minute = timeParts[1]
        guard let startDate = cal.date(from: components) else { return nil }
        ekEvent.startDate = startDate
        ekEvent.endDate = startDate.addingTimeInterval(Double(durationMin!) * 60)
    }

    do {
        try store.save(ekEvent, span: .thisEvent)
        return ekEvent
    } catch {
        fputs("[calendar] failed to save event: \(error)\n", stderr)
        return nil
    }
}

private func dayString(from date: Date) -> String {
    let calendar = Calendar.current
    let components = calendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", components.year!, components.month!, components.day!)
}

// MARK: - Dedup

func dedup() {
    let store = EKEventStore()
    guard requestAccess(store: store) else {
        fputs("[dedup] access denied\n", stderr)
        return
    }

    let config = readCalendarSyncConfig()
    let activeCalIds = Set(config.areaCalendars.values)
    let areas = readAreas()

    // Build the set of titles that belong to active area calendars
    var activeTitles: [String: String] = [:]
    for (areaId, calId) in config.areaCalendars {
        if let cal = store.calendar(withIdentifier: calId) {
            activeTitles[cal.title] = calId
        } else if let area = areas[areaId] {
            activeTitles["\(area.emoji) \(area.name)"] = calId
        }
    }

    var removed = 0

    for cal in store.calendars(for: .event) {
        let id = cal.calendarIdentifier

        // Skip active calendars
        if activeCalIds.contains(id) { continue }

        // Remove legacy "Zenborg" calendar
        if cal.title == LEGACY_CALENDAR_TITLE {
            do {
                try store.removeCalendar(cal, commit: true)
                fputs("[dedup] removed legacy calendar '\(cal.title)'\n", stderr)
                removed += 1
            } catch {
                fputs("[dedup] failed to remove '\(cal.title)': \(error)\n", stderr)
            }
            continue
        }

        // Remove duplicates: same title as an active area calendar, different id
        if activeTitles[cal.title] != nil {
            do {
                try store.removeCalendar(cal, commit: true)
                fputs("[dedup] removed duplicate calendar '\(cal.title)' (\(id))\n", stderr)
                removed += 1
            } catch {
                fputs("[dedup] failed to remove '\(cal.title)': \(error)\n", stderr)
            }
        }
    }

    if removed == 0 {
        fputs("[dedup] no duplicates found\n", stderr)
    } else {
        fputs("[dedup] removed \(removed) calendar(s)\n", stderr)
    }
}

// MARK: - Date extension

extension Date {
    var iso8601: String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: self)
    }
}
