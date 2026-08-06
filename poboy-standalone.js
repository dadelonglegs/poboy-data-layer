/**
 * Po'Boy Data Layer v0.9.0-beta
 * GitHub: github.com/dadelonglegs/poboy-data-layer
 * Features: Standalone Data Layer, GA4 Base Tag, Auto-Server Logging to /poboy/log.php,
 * Native HTML5 Geolocation Permission Prompt, Cumulative Parameter Vaulting & Sandwich Handles.
 */
(function (window, document) {
    'use strict';

    const CONFIG = Object.assign({
        endpoint: (function() {
            return window.location.origin + '/poboy/log.php';
        })(),
        cookieName: '_poboy_ident',
        userIdKey: '_poboy_user_id',
        friendlyNameKey: '_poboy_friendly_name',
        sessionName: '_poboy_session',
        paramsVaultKey: '_poboy_param_vault',
        geoCacheKey: '_poboy_geo_cache',
        cookieDays: 730,
        sessionTimeoutMinutes: 30,
        requestGPSPermission: true,
        publishDataLayer: true,
        autoFillGHLForms: true
    }, window.PoBoyConfig || {});

    // PO'BOY SANDWICH INGREDIENT DICTIONARY
    const SANDWICH_ADJECTIVES = [
        'Toasted', 'Smoked', 'Spicy', 'Honey', 'Garlic', 'Chipotle', 'Truffle', 'Cajun', 
        'Crispy', 'Glazed', 'Melted', 'Roasted', 'Pickled', 'Seared', 'Braised', 'Bourbon', 
        'Tangy', 'Savory', 'Zesty', 'Double', 'Triple', 'Loaded', 'Pressed', 'Herb'
    ];

    const SANDWICH_INGREDIENTS = [
        'Provolone', 'Pastrami', 'Brioche', 'Capicola', 'Salami', 'Gouda', 'RoastBeef', 
        'Havarti', 'Muenster', 'Mortadella', 'Ciabatta', 'Sourdough', 'Prosciutto', 
        'Swiss', 'Cheddar', 'Bacon', 'Turkey', 'Meatball', 'Baguette', 'Chorizo', 
        'Pepperoni', 'Fontina', 'Brie', 'Camembert'
    ];

    function generateFriendlyName(seedInput) {
        let seedStr = typeof seedInput === 'string' ? seedInput : String(seedInput || Math.random());
        let hash = 0;
        for (let i = 0; i < seedStr.length; i++) {
            hash = (hash << 5) - hash + seedStr.charCodeAt(i);
            hash |= 0;
        }
        const posHash = Math.abs(hash);
        const adj = SANDWICH_ADJECTIVES[posHash % SANDWICH_ADJECTIVES.length];
        const ing = SANDWICH_INGREDIENTS[Math.floor(posHash / SANDWICH_ADJECTIVES.length) % SANDWICH_INGREDIENTS.length];
        return `${adj}${ing}-${1000 + (posHash % 9000)}`;
    }

    function generateUUID(prefix = 'pb_') {
        return prefix + 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    function getApexDomain() {
        const hostname = window.location.hostname;
        if (hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return null;
        const parts = hostname.split('.');
        return parts.length > 2 ? '.' + parts.slice(-2).join('.') : '.' + hostname;
    }

    const Storage = {
        setCookie(name, value, days) {
            let expires = days ? "; expires=" + new Date(Date.now() + days * 86400000).toUTCString() : "";
            const apex = getApexDomain();
            const dom = apex ? `; domain=${apex}` : "";
            document.cookie = `${name}=${encodeURIComponent(value)}${expires}; path=/${dom}; SameSite=Lax`;
            document.cookie = `${name}=${encodeURIComponent(value)}${expires}; path=/; SameSite=Lax`;
        },

        getCookie(name) {
            const nameEQ = name + "=";
            const ca = document.cookie.split(';');
            for (let i = 0; i < ca.length; i++) {
                let c = ca[i].trim();
                if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length));
            }
            return null;
        },

        setLocal(key, value) { try { localStorage.setItem(key, value); } catch (e) {} },
        getLocal(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
        setSession(key, value) { try { sessionStorage.setItem(key, value); } catch (e) {} },
        getSession(key) { try { return sessionStorage.getItem(key); } catch (e) { return null; } }
    };

    function resolveIdentity() {
        const urlParams = new URLSearchParams(window.location.search);
        const urlUid = urlParams.get('_poboy_uid') || urlParams.get('_cw_uid') || urlParams.get('_sc_uid');

        let savedUid = Storage.getLocal(CONFIG.userIdKey) || Storage.getCookie(CONFIG.userIdKey);
        let savedHandle = Storage.getLocal(CONFIG.friendlyNameKey) || Storage.getCookie(CONFIG.friendlyNameKey);

        let userId = urlUid || savedUid || generateUUID();
        let friendlyHandle = (savedUid === userId && savedHandle) ? savedHandle : (savedHandle && !urlUid ? savedHandle : generateFriendlyName(userId));

        Storage.setLocal(CONFIG.userIdKey, userId);
        Storage.setCookie(CONFIG.userIdKey, userId, CONFIG.cookieDays);
        Storage.setLocal(CONFIG.friendlyNameKey, friendlyHandle);
        Storage.setCookie(CONFIG.friendlyNameKey, friendlyHandle, CONFIG.cookieDays);

        return { user_id: userId, friendly_username: friendlyHandle };
    }

    function resolveSession() {
        let sessStr = Storage.getSession(CONFIG.sessionName);
        let now = Date.now();
        let timeoutMs = CONFIG.sessionTimeoutMinutes * 60000;
        let session = null;

        if (sessStr) {
            try {
                session = JSON.parse(sessStr);
                if (now - session.last_active > timeoutMs) session = null;
            } catch (e) { session = null; }
        }

        if (!session) {
            let sessionNum = parseInt(Storage.getLocal('_poboy_session_count') || '0', 10) + 1;
            Storage.setLocal('_poboy_session_count', sessionNum.toString());
            session = {
                session_id: generateUUID('sess_'),
                session_number: sessionNum,
                start_time: new Date().toISOString(),
                last_active: now,
                page_views_in_session: 1
            };
        } else {
            session.last_active = now;
            session.page_views_in_session = (session.page_views_in_session || 1) + 1;
        }

        Storage.setSession(CONFIG.sessionName, JSON.stringify(session));
        return session;
    }

    function resolveCumulativeParamVault() {
        let vault = {};
        let storedVaultStr = Storage.getLocal(CONFIG.paramsVaultKey) || Storage.getCookie(CONFIG.paramsVaultKey);
        if (storedVaultStr) {
            try { vault = JSON.parse(storedVaultStr); } catch (e) { vault = {}; }
        }

        const urlParams = new URLSearchParams(window.location.search);
        let updated = false;

        for (let [key, val] of urlParams.entries()) {
            if (val !== undefined && val !== null && val !== '') {
                if (vault[key] !== val) {
                    vault[key] = val;
                    updated = true;
                }
            }
        }

        if (updated || !storedVaultStr) {
            const vaultStr = JSON.stringify(vault);
            Storage.setLocal(CONFIG.paramsVaultKey, vaultStr);
            Storage.setCookie(CONFIG.paramsVaultKey, vaultStr, CONFIG.cookieDays);
        }

        const getParam = (k) => vault[k] || null;

        const utms = {
            utm_source: getParam('utm_source'),
            utm_medium: getParam('utm_medium'),
            utm_campaign: getParam('utm_campaign'),
            utm_term: getParam('utm_term'),
            utm_content: getParam('utm_content'),
            utm_id: getParam('utm_id')
        };

        const clickIds = {
            gclid: getParam('gclid'),
            wbraid: getParam('wbraid'),
            gbraid: getParam('gbraid'),
            fbclid: getParam('fbclid'),
            msclkid: getParam('msclkid'),
            ttclid: getParam('ttclid'),
            li_fat_id: getParam('li_fat_id'),
            twclid: getParam('twclid'),
            dclid: getParam('dclid'),
            irclickid: getParam('irclickid'),
            affiliate_id: getParam('affiliate_id') || getParam('aff_id') || getParam('ref')
        };

        let channelGroup = 'Direct';
        if (clickIds.gclid || clickIds.wbraid || clickIds.gbraid) channelGroup = 'Paid Search (Google)';
        else if (clickIds.fbclid) channelGroup = 'Paid Social (Meta)';
        else if (clickIds.msclkid) channelGroup = 'Paid Search (Bing)';
        else if (clickIds.ttclid) channelGroup = 'Paid Social (TikTok)';
        else if (clickIds.li_fat_id) channelGroup = 'Paid Social (LinkedIn)';
        else if (utms.utm_medium) channelGroup = `Campaign (${utms.utm_medium})`;
        else if (document.referrer && document.referrer.includes('google.')) channelGroup = 'Organic Search';

        return { utms, clickIds, vault, channelGroup };
    }

    function resolveUserLocation() {
        let cachedGps = Storage.getLocal('_poboy_gps_cache');
        let parsedGps = null;
        if (cachedGps) {
            try { parsedGps = JSON.parse(cachedGps); } catch (e) {}
        }

        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown';
        const tzOffset = -(new Date().getTimezoneOffset() / 60);
        const lang = navigator.language || navigator.userLanguage || null;

        return {
            city: null,
            region: null,
            country: null,
            country_code: null,
            latitude: parsedGps ? parsedGps.latitude : null,
            longitude: parsedGps ? parsedGps.longitude : null,
            accuracy_meters: parsedGps ? parsedGps.accuracy_meters : null,
            postal_code: null,
            timezone: tz,
            timezone_offset_hours: tzOffset,
            language: lang,
            location_source: parsedGps ? 'gps_cached' : 'timezone_inferred',
            permission_status: parsedGps ? 'granted' : 'prompt'
        };
    }

    function extractStructuredContentMeta() {
        const getM = (n) => {
            const el = document.querySelector(`meta[name="${n}"], meta[property="${n}"]`);
            return el ? el.getAttribute('content') || null : null;
        };
        const getL = (r) => {
            const el = document.querySelector(`link[rel="${r}"]`);
            return el ? el.getAttribute('href') || null : null;
        };

        const schemas = [];
        document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
            try { schemas.push(JSON.parse(s.innerText || s.textContent)); } catch (e) {}
        });

        const h1s = Array.from(document.querySelectorAll('h1')).map(h => h.innerText.trim());
        const h2s = Array.from(document.querySelectorAll('h2')).map(h => h.innerText.trim());

        return {
            meta: {
                page_title: document.title,
                page_location: window.location.href,
                page_path: window.location.pathname,
                description: getM('description') || getM('og:description'),
                keywords: getM('keywords'),
                author: getM('author'),
                robots: getM('robots'),
                viewport: getM('viewport'),
                canonical_url: getL('canonical'),
                favicon_url: getL('icon') || getL('shortcut icon'),
                charset: document.characterSet || document.inputEncoding || null,
                heading_h1: h1s[0] || null,
                all_h1_texts: h1s.length > 0 ? h1s : null,
                heading_h2_first: h2s[0] || null
            },
            social: {
                og_title: getM('og:title'),
                og_type: getM('og:type'),
                og_image: getM('og:image'),
                og_url: getM('og:url'),
                og_site_name: getM('og:site_name'),
                twitter_card: getM('twitter:card'),
                twitter_title: getM('twitter:title'),
                twitter_image: getM('twitter:image')
            },
            schema: {
                json_ld: schemas.length > 0 ? schemas : null,
                types_list: schemas.map(sc => sc['@type'] || 'Thing').join(', ') || null
            },
            dom_metrics: {
                total_h1_count: h1s.length,
                total_h2_count: h2s.length,
                total_links_count: document.links.length,
                total_images_count: document.images.length,
                total_forms_count: document.forms.length,
                total_scripts_count: document.scripts.length,
                dom_nodes_count: document.getElementsByTagName('*').length
            }
        };
    }

    function initTracker() {
        const startTime = performance.now();
        const identity = resolveIdentity();
        const session = resolveSession();
        const { utms, clickIds, vault, channelGroup } = resolveCumulativeParamVault();
        const locationData = resolveUserLocation();
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};
        const contentMeta = extractStructuredContentMeta();

        let touchHistoryStr = Storage.getLocal('_poboy_touches');
        let touchData = { first_touch: null, last_touch: null, visit_count: 0 };
        if (touchHistoryStr) {
            try { touchData = JSON.parse(touchHistoryStr); } catch (e) {}
        }

        const now = new Date().toISOString();
        const currentTouch = {
            timestamp: now,
            session_id: session.session_id,
            page: window.location.href,
            channel_group: channelGroup,
            utms: utms,
            click_ids: clickIds,
            vault_params: vault
        };

        if (!touchData.first_touch) touchData.first_touch = currentTouch;
        touchData.last_touch = currentTouch;
        touchData.visit_count = (touchData.visit_count || 0) + 1;

        Storage.setLocal('_poboy_touches', JSON.stringify(touchData));

        const executionTimeMs = (performance.now() - startTime).toFixed(3);

        const organisedPayload = {
            identity: {
                user_id: identity.user_id,
                friendly_handle: identity.friendly_username,
                friendly_username: identity.friendly_username
            },
            session: {
                session_id: session.session_id,
                session_number: session.session_number,
                session_page_views: session.page_views_in_session || 1,
                visit_count: touchData.visit_count,
                is_first_visit: touchData.visit_count === 1,
                is_returning_user: touchData.visit_count > 1
            },
            attribution: {
                channel_group: channelGroup,
                first_touch_source: touchData.first_touch?.utms?.utm_source || 'direct',
                first_touch_campaign: touchData.first_touch?.utms?.utm_campaign || 'direct',
                utms: utms,
                click_ids: clickIds
            },
            parameters: {
                vault: vault,
                current_url_query: window.location.search || null
            },
            location: locationData,
            meta: contentMeta.meta,
            social: contentMeta.social,
            schema: contentMeta.schema,
            dom_metrics: contentMeta.dom_metrics,
            device: {
                category: /Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'Mobile' : 'Desktop',
                screen_resolution: `${window.screen.width}x${window.screen.height}`,
                viewport_size: `${window.innerWidth}x${window.innerHeight}`,
                hardware_concurrency: navigator.hardwareConcurrency || null,
                device_memory_gb: navigator.deviceMemory || null,
                connection_type: conn.effectiveType || conn.type || 'unknown'
            },
            performance: {
                execution_time_ms: parseFloat(executionTimeMs)
            },
            user_id: identity.user_id,
            friendly_handle: identity.friendly_username,
            channel_group: channelGroup,
            gclid: clickIds.gclid,
            fbclid: clickIds.fbclid,
            page_title: document.title,
            page_location: window.location.href,
            referrer: document.referrer || 'direct'
        };

        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({
            event: 'poboy_loaded',
            poboy: organisedPayload
        });

        // AUTO-SERVER LOGGING (If /poboy/log.php exists on current domain, logs automatically!)
        if (CONFIG.endpoint) {
            const telemetryPayload = {
                user_id: identity.user_id,
                friendly_username: identity.friendly_username,
                session_id: session.session_id,
                visit_count: touchData.visit_count,
                vault_params: vault,
                telemetry: organisedPayload
            };

            fetch(CONFIG.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(telemetryPayload),
                keepalive: true
            }).catch(err => {});
        }

        // NATIVE BROWSER GPS PERMISSION PROMPT TRIGGER
        if (CONFIG.requestGPSPermission && navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                function (position) {
                    const gpsLocation = {
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                        accuracy_meters: position.coords.accuracy,
                        altitude: position.coords.altitude || null,
                        heading: position.coords.heading || null,
                        speed: position.coords.speed || null,
                        timezone: locationData.timezone,
                        timezone_offset_hours: locationData.timezone_offset_hours,
                        language: locationData.language,
                        location_source: 'gps_permission_granted',
                        permission_status: 'granted'
                    };

                    Object.assign(organisedPayload.location, gpsLocation);
                    Storage.setLocal('_poboy_gps_cache', JSON.stringify(gpsLocation));

                    window.dataLayer.push({
                        event: 'poboy_gps_updated',
                        poboy: organisedPayload
                    });

                    if (CONFIG.endpoint) {
                        fetch(CONFIG.endpoint, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                user_id: identity.user_id,
                                friendly_username: identity.friendly_username,
                                session_id: session.session_id,
                                visit_count: touchData.visit_count,
                                vault_params: vault,
                                telemetry: organisedPayload
                            }),
                            keepalive: true
                        }).catch(err => {});
                    }
                },
                function (error) {
                    organisedPayload.location.permission_status = 'denied_or_dismissed';
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
            );
        }
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initTracker();
    } else {
        document.addEventListener('DOMContentLoaded', initTracker);
    }

})(window, document);
