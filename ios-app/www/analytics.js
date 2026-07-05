/**
 * analytics.js — PostHog イベントトラッキング（寄り道マップ / ビルドレス Vanilla JS）
 *
 * 目的: 課金ファネル（ガチャ→コイン購入→完走）と回遊を計測。
 *
 * セットアップ:
 *  1. https://eu.posthog.com で「EUリージョン」のプロジェクト作成
 *  2. 下の POSTHOG_KEY に phc_xxxx を貼る（空のままなら全関数 no-op で安全）
 *  3. index.html で app.js より前に読み込む（既に設定済み）
 *
 * ※ GA4(gtag) は併用。PostHog はイベント/ファネル用。
 * グローバル window.YA.* から呼ぶ。
 */
(function () {
  'use strict';

  var POSTHOG_KEY = 'phc_tybAxtNaoDGheSk6RcfjdxHnhXhCR8TyXLXNZVQGAhC8'; // ← ここに phc_xxxxxxxx を貼ると計測ON
  var POSTHOG_HOST = 'https://eu.i.posthog.com';

  function noop() {}
  // 既定は全て no-op（キー未設定でも app.js が安全に呼べる）
  window.YA = {
    trackAppOpened: noop,
    trackGachaPulled: noop,
    trackCoinPurchaseStarted: noop,
    trackCoinPurchaseSuccess: noop,
    trackCourseCompleted: noop,
    trackCheckin: noop,
    trackShared: noop,
    trackReviewPromptShown: noop,
    trackRatingSubmitted: noop,
    identify: noop,
  };

  if (!POSTHOG_KEY) return; // キーが無ければ何も読み込まない

  // PostHog 公式スニペット（array.js を非同期ロード）
  !(function (t, e) { var o, n, p, r; e.__SV || (window.posthog = e, e._i = [], e.init = function (i, s, a) { function g(t, e) { var o = e.split('.'); 2 == o.length && (t = t[o[0]], e = o[1]), t[e] = function () { t.push([e].concat(Array.prototype.slice.call(arguments, 0))); }; } (p = t.createElement('script')).type = 'text/javascript', p.crossOrigin = 'anonymous', p.async = !0, p.src = s.api_host.replace('.i.posthog.com', '-assets.i.posthog.com') + '/static/array.js', (r = t.getElementsByTagName('script')[0]).parentNode.insertBefore(p, r); var u = e; for (void 0 !== a ? u = e[a] = [] : a = 'posthog', u.people = u.people || [], u.toString = function (t) { var e = 'posthog'; return 'posthog' !== a && (e += '.' + a), t || (e += ' (stub)'), e; }, u.people.toString = function () { return u.toString(1) + '.people (stub)'; }, o = 'init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug'.split(' '), n = 0; n < o.length; n++) g(u, o[n]); e._i.push([i, s, a]); }, e.__SV = 1); })(document, window.posthog || []);

  window.posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: false,
    capture_pageleave: true,
    autocapture: false,
    persistence: 'localStorage+cookie',
  });

  function cap(name, props) {
    try { window.posthog.capture(name, props); } catch (e) { /* noop */ }
  }

  window.YA = {
    trackAppOpened: function () { cap('app_opened'); },
    trackGachaPulled: function (props) { cap('gacha_pulled', props); },
    trackCoinPurchaseStarted: function (props) { cap('coin_purchase_started', props); },
    trackCoinPurchaseSuccess: function (props) { cap('coin_purchase_success', props); },
    trackCourseCompleted: function (props) { cap('course_completed', props); },
    trackCheckin: function (props) { cap('checkin', props); },
    trackShared: function (props) { cap('shared', props); },
    trackReviewPromptShown: function (props) { cap('review_prompt_shown', props); },
    trackRatingSubmitted: function (props) { cap('rating_submitted', props); },
    identify: function (id) { try { window.posthog.identify(id); } catch (e) { /* noop */ } },
  };

  window.YA.trackAppOpened();
})();
