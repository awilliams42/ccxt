'use strict';

//  ---------------------------------------------------------------------------

const Exchange = require ('./base/Exchange');
const { ExchangeError } = require ('./base/errors');

//  ---------------------------------------------------------------------------

module.exports = class crypton extends Exchange {
    describe () {
        return this.deepExtend (super.describe (), {
            'id': 'crypton',
            'name': 'Crypton',
            'countries': 'EU',
            'rateLimit': 500,
            'version': '1',
            'has': {
                'fetchDepositAddress': true,
                'fetchMyTrades': true,
                'fetchOpenOrders': true,
                'fetchOrder': true,
                'fetchTicker': false,
                'fetchTickers': true,
            },
            'urls': {
                'logo': 'https://user-images.githubusercontent.com/40079891/41187456-833318d2-6b5e-11e8-8a70-e04240e25c1c.png',
                'api': 'https://api.cryptonbtc.com',
                'www': 'https://cryptonbtc.com',
                'doc': 'https://cryptonbtc.docs.apiary.io/',
                'fees': 'https://help.cryptonbtc.com/hc/en-us/articles/360004089872-Fees',
            },
            'api': {
                'public': {
                    'get': [
                        'currencies',
                        'markets',
                        'markets/{id}',
                        'markets/{id}/orderbook',
                        'markets/{id}/trades',
                        'tickers',
                    ],
                },
                'private': {
                    'get': [
                        'balances',
                        'orders',
                        'orders/{id}',
                        'fills',
                        'deposit_address/{currency}',
                        'deposits',
                    ],
                    'post': [
                        'orders',
                    ],
                    'delete': [
                        'orders/{id}',
                    ],
                },
            },
            'fees': {
                'trading': {
                    'tierBased': false,
                    'percentage': true,
                    'maker': 0.0020,
                    'taker': 0.0020,
                },
            },
        });
    }

    async fetchMarkets () {
        let response = await this.publicGetMarkets ();
        let result = [];
        let keys = Object.keys (response);
        for (let i = 0; i < keys.length; i++) {
            let id = keys[i];
            let market = response[id];
            let baseId = market['base'];
            let quoteId = market['quote'];
            let base = this.commonCurrencyCode (baseId);
            let quote = this.commonCurrencyCode (quoteId);
            let symbol = base + '/' + quote;
            let precision = {
                'amount': 8,
                'price': this.precisionFromString (this.safeString (market, 'priceStep')),
            };
            let active = market['enabled'];
            result.push ({
                'id': id,
                'symbol': symbol,
                'base': base,
                'quote': quote,
                'baseId': baseId,
                'quoteId': quoteId,
                'active': active,
                'info': market,
                'precision': precision,
                'limits': {
                    'amount': {
                        'min': market['minSize'],
                        'max': undefined,
                    },
                    'price': {
                        'min': market['priceStep'],
                        'max': undefined,
                    },
                },
            });
        }
        return result;
    }

    async fetchBalance (params = {}) {
        await this.loadMarkets ();
        let balances = await this.privateGetBalances (params);
        let result = { 'info': balances };
        let keys = Object.keys (balances);
        for (let i = 0; i < keys.length; i++) {
            let id = keys[i];
            let currency = this.commonCurrencyCode (id);
            let account = this.account ();
            let balance = balances[id];
            let total = parseFloat (balance['total']);
            let free = parseFloat (balance['free']);
            let used = parseFloat (balance['locked']);
            account['total'] = total;
            account['free'] = free;
            account['used'] = used;
            result[currency] = account;
        }
        return this.parseBalance (result);
    }

    async fetchOrderBook (symbol, limit = undefined, params = {}) {
        await this.loadMarkets ();
        let orderbook = await this.publicGetMarketsIdOrderbook (this.extend ({
            'id': this.marketId (symbol),
        }, params));
        return this.parseOrderBook (orderbook);
    }

    parseTicker (ticker, market = undefined) {
        let symbol = undefined;
        if (market)
            symbol = market['symbol'];
        let last = this.safeFloat (ticker, 'last');
        let relativeChange = this.safeFloat (ticker, 'change24h', 0.0);
        return {
            'symbol': symbol,
            'timestamp': undefined,
            'datetime': undefined,
            'high': undefined,
            'low': undefined,
            'bid': this.safeFloat (ticker, 'bid'),
            'bidVolume': undefined,
            'ask': this.safeFloat (ticker, 'ask'),
            'askVolume': undefined,
            'vwap': undefined,
            'open': undefined,
            'close': last,
            'last': last,
            'previousClose': undefined,
            'change': undefined,
            'percentage': relativeChange * 100,
            'average': undefined,
            'baseVolume': this.safeFloat (ticker, 'volume24h'),
            'quoteVolume': undefined,
            'info': ticker,
        };
    }

    async fetchTickers (symbols = undefined, params = {}) {
        await this.loadMarkets ();
        let tickers = await this.publicGetTickers (params);
        let keys = Object.keys (tickers);
        let result = {};
        for (let i = 0; i < keys.length; i++) {
            let id = keys[i];
            let ticker = tickers[id];
            let market = undefined;
            let symbol = id;
            if (id in this.markets_by_id) {
                market = this.markets_by_id[id];
                symbol = market['symbol'];
            } else {
                symbol = this.parseSymbol (id);
            }
            result[symbol] = this.parseTicker (ticker, market);
        }
        return result;
    }

    parseTrade (trade, market = undefined) {
        let timestamp = this.parse8601 (trade['time']);
        let symbol = undefined;
        if ('market' in trade) {
            let marketId = trade['market'];
            if (marketId in this.markets_by_id) {
                market = this.markets_by_id[marketId];
            } else {
                symbol = this.parseSymbol (marketId);
            }
        }
        if (market) {
            symbol = market['symbol'];
        }
        let fee = undefined;
        if ('fee' in trade) {
            fee = {
                'cost': this.safeFloat (trade, 'fee'),
                'currency': this.commonCurrencyCode (trade['feeCurrency']),
            };
        }
        return {
            'id': trade['id'].toString (),
            'info': trade,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'symbol': symbol,
            'type': undefined,
            'side': trade['side'],
            'price': this.safeFloat (trade, 'price'),
            'amount': this.safeFloat (trade, 'size'),
            'order': this.safeString (trade, 'orderId'),
            'fee': fee,
        };
    }

    async fetchTrades (symbol, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        let market = this.market (symbol);
        let request = {
            'id': market['id'],
        };
        if (limit)
            request['limit'] = limit;
        let response = await this.publicGetMarketsIdTrades (this.extend (request, params));
        return this.parseTrades (response, market, since, limit);
    }

    async fetchMyTrades (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        let market = this.market (symbol);
        let request = {};
        if (limit)
            request['limit'] = limit;
        let response = await this.privateGetFills (this.extend (request, params));
        let trades = this.parseTrades (response, market, since, limit);
        return this.filterBySymbol (trades, symbol);
    }

    parseOrder (order, market = undefined) {
        let id = order['id'].toString ();
        let status = order['status'];
        let side = order['side'];
        let type = order['type'];
        let symbol = undefined;
        let marketId = order['market'];
        if (marketId in this.markets_by_id) {
            market = this.markets_by_id[marketId];
            symbol = market['symbol'];
        } else {
            symbol = this.parseSymbol (marketId);
        }
        let timestamp = this.parse8601 (order['createdAt']);
        let iso8601 = this.iso8601 (timestamp);
        let fee = undefined;
        if ('fee' in order) {
            fee = {
                'cost': parseFloat (order['fee']),
                'currency': this.commonCurrencyCode (order['feeCurrency']),
            };
        }
        let price = this.safeFloat (order, 'price');
        let amount = this.safeFloat (order, 'size');
        let filled = this.safeFloat (order, 'filledSize');
        let remaining = amount - filled;
        let cost = filled * price;
        let result = {
            'info': order,
            'id': id,
            'timestamp': timestamp,
            'datetime': iso8601,
            'lastTradeTimestamp': undefined,
            'symbol': symbol,
            'type': type,
            'side': side,
            'price': price,
            'cost': cost,
            'average': undefined,
            'amount': amount,
            'filled': filled,
            'remaining': remaining,
            'status': status,
            'fee': fee,
        };
        return result;
    }

    async fetchOrder (id, symbol = undefined, params = {}) {
        await this.loadMarkets ();
        let request = {
            'id': id,
        };
        let response = await this.privateGetOrdersId (this.extend (request, params));
        return this.parseOrder (response);
    }

    async fetchOpenOrders (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        let request = {};
        let market = undefined;
        if (symbol) {
            request['market'] = this.marketId (symbol);
        }
        let response = await this.privateGetOrders (this.extend (request, params));
        return this.parseOrders (response, market, since, limit);
    }

    async createOrder (symbol, type, side, amount, price = undefined, params = {}) {
        await this.loadMarkets ();
        let order = {
            'market': this.marketId (symbol),
            'side': side,
            'type': type,
            'size': this.amountToPrecision (symbol, amount),
            'price': this.priceToPrecision (symbol, price),
        };
        let response = await this.privatePostOrders (this.extend (order, params));
        return this.parseOrder (response);
    }

    async cancelOrder (id, symbol = undefined, params = {}) {
        await this.loadMarkets ();
        let request = {
            'id': id,
        };
        let response = await this.privateDeleteOrdersId (this.extend (request, params));
        return this.parseOrder (response);
    }

    parseSymbol (id) {
        let [ base, quote ] = id.split ('-');
        base = this.commonCurrencyCode (base);
        quote = this.commonCurrencyCode (quote);
        return base + '/' + quote;
    }

    async fetchDepositAddress (code, params = {}) {
        await this.loadMarkets ();
        let currency = this.currency (code);
        let response = await this.privateGetDepositAddressCurrency (this.extend ({
            'currency': currency['id'],
        }, params));
        let address = this.safeString (response, 'address');
        let tag = this.safeString (response, 'tag');
        this.checkAddress (address);
        return {
            'currency': code,
            'address': address,
            'tag': tag,
            'status': 'ok',
            'info': response,
        };
    }

    sign (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        let request = '/' + this.implodeParams (path, params);
        let query = this.omit (params, this.extractParams (path));
        if (method === 'GET') {
            if (Object.keys (query).length)
                request += '?' + this.urlencode (query);
        }
        let url = this.urls['api'] + request;
        if (api === 'private') {
            this.checkRequiredCredentials ();
            let timestamp = this.milliseconds ().toString ();
            let payload = '';
            if (method !== 'GET') {
                if (Object.keys (query).length) {
                    body = this.json (query);
                    payload = body;
                }
            }
            let what = timestamp + method + request + payload;
            let signature = this.hmac (this.encode (what), this.encode (this.secret), 'sha256');
            headers = {
                'CRYPTON-APIKEY': this.apiKey,
                'CRYPTON-SIGNATURE': signature,
                'CRYPTON-TIMESTAMP': timestamp,
                'Content-Type': 'application/json',
            };
        }
        return { 'url': url, 'method': method, 'body': body, 'headers': headers };
    }

    handleErrors (code, reason, url, method, headers, body) {
        if (body[0] === '{') {
            let response = JSON.parse (body);
            let success = this.safeValue (response, 'success');
            if (!success) {
                throw new ExchangeError (this.id + ' ' + body);
            }
        }
    }

    async request (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        let response = await this.fetch2 (path, api, method, params, headers, body);
        return response['result'];
    }
};
