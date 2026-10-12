import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Compile the complete current production coordinator against deterministic OS
// boundaries. No extracted/rewritten scheduling algorithm and no remote actions.
// This complements XCTest of the real AlarmKit adapter; it does NOT validate
// physical notification delivery or system authorization.
const systemBoundaries = [
  "import Foundation",
  "import Combine",
  "struct UNNotificationPresentationOptions: OptionSet { let rawValue:Int; static let banner=Self(rawValue:1); static let sound=Self(rawValue:2) }",
  "struct UNAuthorizationOptions: OptionSet { let rawValue:Int; static let alert=Self(rawValue:1); static let sound=Self(rawValue:2) }",
  "enum UNAuthorizationStatus { case notDetermined,denied,authorized,provisional,ephemeral }",
  "enum UNNotificationSetting { case enabled,disabled }",
  "struct UNNotificationSettings { var authorizationStatus:UNAuthorizationStatus = .authorized; var soundSetting:UNNotificationSetting = .enabled; var lockScreenSetting:UNNotificationSetting = .enabled }",
  "struct UNNotificationSound { static let `default`=Self() }",
  "final class UNMutableNotificationContent { var title=\"\"; var body=\"\"; var sound:UNNotificationSound?; var threadIdentifier=\"\"; var userInfo:[AnyHashable:Any]=[:] }",
  "struct UNTimeIntervalNotificationTrigger { let timeInterval:TimeInterval; let repeats:Bool }",
  "struct UNNotificationRequest { let identifier:String; let content:UNMutableNotificationContent; let trigger:UNTimeIntervalNotificationTrigger }",
  "struct UNNotification { let request:UNNotificationRequest }",
  "struct UNNotificationResponse { let notification:UNNotification }",
  "protocol UNUserNotificationCenterDelegate: AnyObject {}",
  "final class UNUserNotificationCenter {",
  "    static func current()->UNUserNotificationCenter { Self() }",
  "    weak var delegate:(any UNUserNotificationCenterDelegate)?",
  "    var pending:[String:UNNotificationRequest]=[:]; var adds=0",
  "    func requestAuthorization(options:UNAuthorizationOptions) async throws -> Bool { true }",
  "    func notificationSettings() async -> UNNotificationSettings { .init() }",
  "    func removePendingNotificationRequests(withIdentifiers ids:[String]) { ids.forEach { pending[$0]=nil } }",
  "    func removeDeliveredNotifications(withIdentifiers ids:[String]) {}",
  "    func pendingNotificationRequests() async -> [UNNotificationRequest] { Array(pending.values) }",
  "    func deliveredNotifications() async -> [UNNotification] { [] }",
  "    func add(_ request:UNNotificationRequest) async throws { adds += 1; pending[request.identifier]=request }",
  "}",
  "final class UINotificationFeedbackGenerator { enum Kind { case success }; func notificationOccurred(_ kind:Kind) {} }",
  "enum NativeRestAlarmResult { case scheduled,unavailable,uncertain }",
  "enum NativeRestAlarmCancellationResult { case cancelled,uncertain }",
  "@MainActor final class NativeAlarmProvider {",
  "    static let shared=NativeAlarmProvider()",
  "    var result:NativeRestAlarmResult = .unavailable",
  "    var cancellation:NativeRestAlarmCancellationResult = .cancelled",
  "    var activeIDs: Set<String> = []; var schedules=0; var cancelAllCalls=0; var onSchedule:(()->Void)?; var onCancel:((String) async -> Void)?",
  "    func scheduleRestResult(id:String,title:String,endsAt:Date) async -> NativeRestAlarmResult { schedules += 1; onSchedule?(); if result == .scheduled { activeIDs.insert(id) }; return result }",
  "    func cancelRestResult(id:String) async -> NativeRestAlarmCancellationResult { await onCancel?(id); if cancellation == .cancelled { activeIDs.remove(id) }; return cancellation }",
  "    func cancelAllResult() async -> NativeRestAlarmCancellationResult { cancelAllCalls += 1; if cancellation == .cancelled { activeIDs.removeAll() }; return cancellation }",
  "}",
  ""
].join("\n");
const acceptanceScenarios = [
  "import Foundation",
  "@main struct RestTests {",
  " @MainActor static func main() async {",
  "    let suite=\"f1t-isolated-rest-\"+UUID().uuidString",
  "    let defaults=UserDefaults(suiteName:suite)!",
  "    defer { defaults.removePersistentDomain(forName:suite) }",
  "    let center=UNUserNotificationCenter(), provider=NativeAlarmProvider()",
  "    let service=NativeRestNotifications(center:center,defaults:defaults,alarmProvider:provider)",
  "    service.attach(isCurrent: { true })",
  "    let end=Date().addingTimeInterval(120)",
  "    func check(_ value:Bool,_ label:String) { precondition(value,label) }",
  "    provider.result = .uncertain; provider.cancellation = .uncertain",
  "    await service.replace(id:\"f1t.native.rest.old\",title:\"Descanso\",endsAt:end,url:nil)",
  "    check(center.adds==0,\"uncertain never falls back\")",
  "    check(service.deliveryMessage != nil,\"uncertainty surfaced\")",
  "    await service.refreshPermission()",
  "    check(service.deliveryMessage != nil,\"permission refresh cannot hide uncertainty\")",
  "    service.invalidate()",
  "    await service.replace(id:\"f1t.native.rest.extended\",title:\"Descanso\",endsAt:end.addingTimeInterval(30),url:nil)",
  "    check(center.adds==0,\"changed deadline cannot double-alert after uncertain cancellation\")",
  "    await service.cancel()",
  "    check(!(defaults.stringArray(forKey:\"native.workout.restNoticeCancellationIDs\") ?? []).isEmpty,\"uncertain cancellation retains IDs\")",
  "    check(service.deliveryMessage != nil,\"cancel warning retained\")",
  "    provider.cancellation = .cancelled",
  "    await service.cancel()",
  "    check(defaults.stringArray(forKey:\"native.workout.restNoticeCancellationIDs\")==nil,\"confirmed cancellation clears journal\")",
  "    check(service.deliveryMessage==nil,\"successful retry clears warning\")",
  "    provider.result = .unavailable",
  "    await service.replace(id:\"f1t.native.rest.local\",title:\"Descanso\",endsAt:end,url:nil)",
  "    await service.replace(id:\"f1t.native.rest.local\",title:\"Descanso\",endsAt:end,url:nil)",
  "    check(center.adds==1 && center.pending.count==1,\"confirmed fallback is idempotent\")",
  "    provider.result = .scheduled",
  "    await service.replace(id:\"f1t.native.rest.alarm\",title:\"Descanso\",endsAt:end,url:nil)",
  "    check(center.adds==1 && center.pending.isEmpty,\"successful AlarmKit suppresses local alert\")",
  "    provider.cancellation = .uncertain",
  "    provider.onSchedule = { service.invalidate() }",
  "    await service.replace(id:\"f1t.native.rest.stale\",title:\"Descanso\",endsAt:end,url:nil)",
  "    check(center.adds==1,\"stale schedule cannot create fallback\")",
  "    check(service.deliveryMessage != nil,\"stale accepted alarm cancellation warning surfaced\")",
  "    check(!(defaults.stringArray(forKey:\"native.workout.restNoticeCancellationIDs\") ?? []).isEmpty,\"stale cancellation keeps retry IDs\")",
  "    // Suspend OLD cancellation, install NEW alarm, then resume OLD. The",
  "    // superseded operation must never run cancelAll against the new rest.",
  "    provider.onSchedule = nil; provider.cancellation = .cancelled",
  "    await service.replace(id:\"f1t.native.rest.race-old\",title:\"Descanso\",endsAt:end,url:nil)",
  "    var resumeOld: CheckedContinuation<Void,Never>?",
  "    var suspended=false",
  "    provider.onCancel = { id in",
  "        if id==\"f1t.native.rest.race-old\" {",
  "            await withCheckedContinuation { continuation in resumeOld=continuation; suspended=true }",
  "        }",
  "    }",
  "    let globalCallsBefore=provider.cancelAllCalls",
  "    let oldCancellation=Task { await service.cancel() }",
  "    while !suspended { await Task.yield() }",
  "    await service.replace(id:\"f1t.native.rest.race-new\",title:\"Descanso\",endsAt:end.addingTimeInterval(30),url:nil)",
  "    check(defaults.string(forKey:\"native.workout.restNoticeID\")==\"f1t.native.rest.race-new\",\"new rest installed during old suspension\")",
  "    resumeOld?.resume()",
  "    await oldCancellation.value",
  "    check(provider.cancelAllCalls==globalCallsBefore,\"superseded cancel must NOT cancelAll new alarm\")",
  "    check(defaults.string(forKey:\"native.workout.restNoticeID\")==\"f1t.native.rest.race-new\",\"old cancel cannot clear new tracking\")",
  "    check(center.adds==1,\"race cannot add ordinary fallback after alarm success\")",
  "    check(provider.activeIDs.contains(\"f1t.native.rest.race-new\"),\"old cancellation must leave NEW alarm active\")",
  "    // Cold launch from an ALREADY delivered notice must recover exact scope",
  "    // before navigation, without recreating the expired countdown/alert.",
  "    let coldDefaults=UserDefaults(suiteName:suite+\".cold\")!",
  "    defer { coldDefaults.removePersistentDomain(forName:suite+\".cold\") }",
  "    coldDefaults.set(\"f1t.native.rest.delivered\",forKey:\"native.workout.restNoticeID\")",
  "    let cold=NativeRestNotifications(center:center,defaults:coldDefaults,alarmProvider:provider)",
  "    let link=URL(string:\"f1t://workout?date=2026-10-08&day=day\")!",
  "    cold.attach(isCurrent:{true},restoreWorkout:{cold.restoreDeliveredNotice(id:\"f1t.native.rest.delivered\",url:link)})",
  "    let content=UNMutableNotificationContent(); content.userInfo=[\"workoutURL\":link.absoluteString]",
  "    let delivered=UNNotificationResponse(notification:UNNotification(request:UNNotificationRequest(identifier:\"f1t.native.rest.delivered\",content:content,trigger:.init(timeInterval:1,repeats:false))))",
  "    var opened:URL?",
  "    let token=NotificationCenter.default.addObserver(forName:.nativeWorkoutOpenRequested,object:nil,queue:nil) { opened=$0.object as? URL }",
  "    await cold.userNotificationCenter(center,didReceive:delivered)",
  "    check(opened==link,\"cold expired notice resumes exact guided workout\")",
  "    check(center.adds==1,\"cold expired notice cannot restart alert\")",
  "    opened=nil",
  "    cold.attach(isCurrent:{false},restoreWorkout:{})",
  "    await cold.userNotificationCenter(center,didReceive:delivered)",
  "    check(opened==nil,\"foreign owner cannot navigate from old notice\")",
  "    NotificationCenter.default.removeObserver(token)",
  "    print(\"Rest-alert uncertainty, cancellation, old/new race and cold-navigation checks passed\")",
  " }",
  "}",
  ""
].join("\n");

test('actual rest coordinator keeps NEW alarm after suspended OLD cancellation and never falls back on uncertainty', { timeout: 60000 }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'fit-rest-coordinator-regression-'));
  try {
    const source = readFileSync('ios/App/Native/native-rest-notifications.swift', 'utf8');
    const production = source.replace(/^import (UIKit|UserNotifications)\s*$/gm, '');
    writeFileSync(join(directory, 'Boundaries.swift'), systemBoundaries);
    writeFileSync(join(directory, 'Production.swift'), production);
    writeFileSync(join(directory, 'Scenarios.swift'), acceptanceScenarios);
    const executable = join(directory, 'checks');
    const compile = spawnSync('swiftc', ['-swift-version', '5', '-parse-as-library', join(directory, 'Boundaries.swift'), join(directory, 'Production.swift'), join(directory, 'Scenarios.swift'), '-o', executable], { encoding: 'utf8', timeout: 45000 });
    assert.equal(compile.error, undefined, compile.error?.message);
    assert.equal(compile.status, 0, compile.stderr);
    const run = spawnSync(executable, [], { encoding: 'utf8', timeout: 10000 });
    assert.equal(run.error, undefined, run.error?.message);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /old\/new race and cold-navigation checks passed/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
