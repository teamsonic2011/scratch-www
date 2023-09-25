const webdriver = require('selenium-webdriver');
const {PageLoadStrategy} = require('selenium-webdriver/lib/capabilities');
const chrome = require('selenium-webdriver/chrome');
const bindAll = require('lodash.bindall');
const chromedriver = require('chromedriver');
const chromedriverVersion = chromedriver.version;

const headless = process.env.SMOKE_HEADLESS || false;
const remote = process.env.SMOKE_REMOTE || false;
const ci = process.env.CI || false;
const usingCircle = process.env.CIRCLECI || false;
const buildID = process.env.CIRCLE_BUILD_NUM || '0000';
const {SAUCE_USERNAME, SAUCE_ACCESS_KEY} = process.env;
const {By, Key, until} = webdriver;

const DEFAULT_TIMEOUT_MILLISECONDS = 20 * 1000;

/**
 * Embed a causal error into an outer error, and add its message to the outer error's message.
 * This compensates for the loss of context caused by `regenerator-runtime`.
 * @param {Error} outerError The error to embed the cause into.
 * @param {Error} cause The "inner" error to embed.
 * @returns {Error} The outerError, with the cause embedded.
 */
const embedCause = (outerError, cause) => {
    if (cause) {
        // This is the official way to nest errors in Node.js, but Jest ignores this field.
        // It's here in case a future version uses it, or in case the caller does.
        outerError.cause = cause;
    }
    if (cause && cause.message) {
        outerError.message += '\n' + ['Cause:', ...cause.message.split('\n')].join('\n    ');
    } else {
        outerError.message += '\nCause: unknown';
    }
    return outerError;
};

class SeleniumHelper {
    constructor () {
        bindAll(this, [
            'buildDriver',
            'clickButton',
            'clickCss',
            'clickText',
            'clickXpath',
            'containsClass',
            'dragFromXpathToXpath',
            'findByCss',
            'findByXpath',
            'findText',
            'getKey',
            'getDriver',
            'getLogs',
            'getSauceDriver',
            'isSignedIn',
            'navigate',
            'signIn',
            'urlMatches',
            'waitUntilDocumentReady',
            'waitUntilGone'
        ]);
    }
    buildDriver (name) {
        if (remote === 'true'){
            let nameToUse;
            if (ci === 'true'){
                let ciName = usingCircle ? 'circleCi ' : 'unknown ';
                nameToUse = ciName + buildID + ' : ' + name;
            } else {
                nameToUse = name;
            }
            this.driver = this.getSauceDriver(SAUCE_USERNAME, SAUCE_ACCESS_KEY, nameToUse);
        } else {
            this.driver = this.getDriver();
        }
        return this.driver;
    }

    getDriver () {
        // JEST_WORKER_ID will always be '1' with --runInBand
        // in that case, we want to use the default port so tools like VSCode can attach to the debugger
        const defaultPort = 9222;
        const workerIndex = parseInt(process.env.JEST_WORKER_ID || '1', 10) - 1; // one-based ID => zero-based index
        const portNumber = defaultPort + workerIndex;

        const chromeOptions = new chrome.Options();
        if (headless) {
            chromeOptions.addArguments('--headless');
        }
        chromeOptions.addArguments('window-size=1024,1680');
        chromeOptions.addArguments('--no-sandbox');
        chromeOptions.addArguments('--disable-dev-shm-using');
        chromeOptions.addArguments(`--remote-debugging-port=${portNumber}`);
        chromeOptions.setPageLoadStrategy(PageLoadStrategy.EAGER);
        let driver = new webdriver.Builder()
            .forBrowser('chrome')
            .withCapabilities(chromeOptions)
            .build();

        // setting throughput values to 0 means unlimited
        driver.setNetworkConditions({
            latency: 0, // additional latency (ms)
            download_throughput: 0 * 1024, // max aggregated download throughput (bps)
            upload_throughput: 0 * 1024, // max aggregated upload throughput (bps)
            offline: false
        });

        return driver;
    }

    getChromeVersionNumber () {
        const versionFinder = /\d+\.\d+/;
        const versionArray = versionFinder.exec(chromedriverVersion);
        if (versionArray === null) {
            throw new Error('couldn\'t find version of chromedriver');
        }
        return versionArray[0];
    }

    getSauceDriver (username, accessKey, name) {
        const chromeVersion = this.getChromeVersionNumber();
        // Driver configs can be generated with the Sauce Platform Configurator
        // https://wiki.saucelabs.com/display/DOCS/Platform+Configurator
        const driverConfig = {
            browserName: 'chrome',
            platform: 'macOS 10.14',
            version: chromeVersion
        };
        const driver = new webdriver.Builder()
            .withCapabilities({
                browserName: driverConfig.browserName,
                platform: driverConfig.platform,
                version: driverConfig.version,
                username: username,
                accessKey: accessKey,
                name: name
            })
            .usingServer(`http://${username}:${accessKey}@ondemand.saucelabs.com:80/wd/hub`)
            .build();
        return driver;
    }

    getKey (keyName) {
        return Key[keyName];
    }

    /**
     * Wait until the document is ready (i.e. the document.readyState is 'complete')
     * @returns {Promise} A promise that resolves when the document is ready
     */
    async waitUntilDocumentReady () {
        const outerError = new Error('waitUntilDocumentReady failed');
        try {
            await this.driver.wait(
                async () => await this.driver.executeScript('return document.readyState;') === 'complete',
                DEFAULT_TIMEOUT_MILLISECONDS
            );
        } catch (cause) {
            throw embedCause(outerError, cause);
        }
    }

    /**
     * Navigate to the given URL and wait until the document is ready.
     * The Selenium docs say the promise returned by `driver.get()` "will be resolved when the document has finished
     * loading." In practice, that doesn't mean the page is ready for testing. I suspect it comes down to the
     * difference between "interactive" and "complete" (or `DOMContentLoaded` and `load`).
     * @param {string} url The URL to navigate to.
     * @returns {Promise} A promise that resolves when the document is ready
     */
    async navigate (url) {
        const outerError = new Error(`navigate failed with arguments:\n\turl: ${url}`);
        try {
            await this.driver.get(url);
            await this.waitUntilDocumentReady();
        } catch (cause) {
            throw embedCause(outerError, cause);
        }
    }

    async findByXpath (xpath) {
        const outerError = new Error(`findByXpath failed with arguments:\n\txpath: ${xpath}`);
        try {
            const el = await this.driver.wait(until.elementLocated(By.xpath(xpath)), DEFAULT_TIMEOUT_MILLISECONDS);
            await this.driver.wait(el.isDisplayed(), DEFAULT_TIMEOUT_MILLISECONDS);
            return el;
        } catch (cause) {
            throw embedCause(outerError, cause);
        }
    }

    async waitUntilGone (element) {
        const outerError = new Error(`waitUntilGone failed with arguments:\n\telement: ${element}`);
        try {
            await this.driver.wait(until.stalenessOf(element), DEFAULT_TIMEOUT_MILLISECONDS);
        } catch (cause) {
            throw embedCause(outerError, cause);
        }
    }

    async clickXpath (xpath) {
        const outerError = new Error(`clickXpath failed with arguments:\n\txpath: ${xpath}`);
        try {
            return await this.driver.wait(new webdriver.WebElementCondition(
                'for element click to succeed',
                async () => {
                    const element = await this.findByXpath(xpath);
                    if (!element) {
                        return null;
                    }
                    try {
                        await element.click();
                        return element;
                    } catch (e) {
                        if (e instanceof webdriver.error.ElementClickInterceptedError) {
                            // something is in front of the element we want to click
                            // probably the loading screen
                            // this is the main reason for using wait()
                            return null;
                        }
                        throw e;
                    }
                }
            ), DEFAULT_TIMEOUT_MILLISECONDS);
        } catch (cause) {
            throw embedCause(outerError, cause);
        }
    }

    async clickText (text) {
        const outerError = new Error(`clickText failed with arguments:\n\ttext: ${text}`);
        try {
            return await this.clickXpath(`//*[contains(text(), '${text}')]`);
        } catch (cause) {
            throw embedCause(outerError, cause);
        }
    }

    async findText (text) {
        const outerError = new Error(`findText failed with arguments:\n\ttext: ${text}`);
        try {
            return await this.driver.wait(
                until.elementLocated(By.xpath(`//*[contains(text(), '${text}')]`)),
                DEFAULT_TIMEOUT_MILLISECONDS
            );
        } catch (cause) {
            throw embedCause(outerError, cause);
        }
    }

    async clickButton (text) {
        const outerError = new Error(`clickButton failed with arguments:\n\ttext: ${text}`);
        try {
            return await this.clickXpath(`//button[contains(text(), '${text}')]`);
        } catch (cause) {
            throw embedCause(outerError, cause);
        }
    }

    async findByCss (css) {
        const outerError = new Error(`findByCss failed with arguments:\n\tcss: ${css}`);
        try {
            return await this.driver.wait(until.elementLocated(By.css(css)), DEFAULT_TIMEOUT_MILLISECONDS);
        } catch (cause) {
            throw embedCause(outerError, cause);
        }
    }

    async clickCss (css) {
        const outerError = new Error(`clickCss failed with arguments:\n\tcss: ${css}`);
        try {
            const el = await this.findByCss(css);
            return await el.click();
        } catch (cause) {
            throw embedCause(outerError, cause);
        }
    }

    async dragFromXpathToXpath (startXpath, endXpath) {
        const outerError = new Error(
            `dragFromXpathToXpath failed with arguments:\n\tstartXpath: ${startXpath}\n\tendXpath: ${endXpath}`
        );
        try {
            const startEl = await this.findByXpath(startXpath);
            const endEl = await this.findByXpath(endXpath);
            return await this.driver.actions()
                .dragAndDrop(startEl, endEl)
                .perform();
        } catch (cause) {
            throw embedCause(outerError, cause);
        }
    }

    getPathForLogin () {
        return '//li[@class="link right login-item"]/a';
    }

    getPathForProfileName () {
        return '//span[contains(@class, "profile-name")]';
    }

    async isSignedIn () {
        const outerError = new Error('isSignedIn failed');
        let cause;
        try {
            const state = await this.driver.wait(
                () => this.driver.executeScript(
                    `
                    if (document.evaluate(arguments[0], document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
                        .singleNodeValue) {
                        return 'signed in';
                    }
                    if (document.evaluate(arguments[1], document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
                        .singleNodeValue) {
                        return 'signed out';
                    }
                    `,
                    this.getPathForProfileName(),
                    this.getPathForLogin()
                ),
                DEFAULT_TIMEOUT_MILLISECONDS
            );
            switch (state) {
            case 'signed in':
                return true;
            case 'signed out':
                return false;
            default:
                throw new Error(`unexpected state: ${state}`);
            }
        } catch (e) {
            cause = e;
            // fall through to the error case below
        }

        // the script returned an unexpected value or, more likely, driver.wait threw an error (probably a timeout)
        throw embedCause(outerError, cause);
    }

    // must be used on a www page
    async signIn (username, password) {
        const outerError = new Error(
            `signIn failed with arguments:\n\tusername: ${username}\n\tpassword: ${password ? 'provided' : 'missing'}`
        );
        try {
            await this.clickXpath(this.getPathForLogin());
            let nameInput = await this.findByXpath('//input[@id="frc-username-1088"]');
            await nameInput.sendKeys(username);
            let passwordInput = await this.findByXpath('//input[@id="frc-password-1088"]');
            await passwordInput.sendKeys(password + this.getKey('ENTER'));
            await this.findByXpath(this.getPathForProfileName());
        } catch (cause) {
            throw embedCause(outerError, cause);
        }
    }

    async urlMatches (regex) {
        const outerError = new Error(`urlMatches failed with arguments:\n\tregex: ${regex}`);
        try {
            return await this.driver.wait(until.urlMatches(regex), DEFAULT_TIMEOUT_MILLISECONDS);
        } catch (cause) {
            throw embedCause(outerError, cause);
        }
    }

    async getLogs (whitelist) {
        const entries = await this.driver.manage()
            .logs()
            .get('browser');
        return entries.filter((entry) => {
            const message = entry.message;
            for (const element of whitelist) {
                if (message.indexOf(element) !== -1) {
                    // eslint-disable-next-line no-console
                    // console.warn('Ignoring whitelisted error: ' + whitelist[i]);
                    return false;
                } else if (entry.level !== 'SEVERE') {
                    // eslint-disable-next-line no-console
                    // console.warn('Ignoring non-SEVERE entry: ' + message);
                    return false;
                }
                return true;
            }
            return true;
        });
    }

    async containsClass (element, cl) {
        const outerError = new Error(`containsClass failed with arguments:\n\telement: ${element}\n\tcl: ${cl}`);
        try {
            let classes = await element.getAttribute('class');
            let classList = classes.split(' ');
            return classList.includes(cl);
        } catch (cause) {
            throw embedCause(outerError, cause);
        }
    }

    async waitUntilVisible (element, driver) {
        const outerError = new Error(`waitUntilVisible failed with arguments:\n\telement: ${element}`);
        try {
            await driver.wait(until.elementIsVisible(element), DEFAULT_TIMEOUT_MILLISECONDS);
        } catch (cause) {
            throw embedCause(outerError, cause);
        }
    }
}

module.exports = SeleniumHelper;
