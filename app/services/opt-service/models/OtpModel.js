const { jwt: jwtConfig } = require('./../../../config/app')


const User = require('./UserModel')

const JWT = require('jsonwebtoken');

const redis = require('redis');

const table = 'otp';

const generateCode = function () {

    // return '55555' // for test


    return '' +
        Math.floor(Math.random() * 10) +
        Math.floor(Math.random() * 10) +
        Math.floor(Math.random() * 10) +
        Math.floor(Math.random() * 10) +
        Math.floor(Math.random() * 10)

}

function getByPhoneNumber(connection, phoneNumber) {
    return new Promise((resolve, reject) => {
        let query = 'SELECT * FROM ' + table + ' WHERE phone = ? ' // LIMIT 1
        connection.query(query, [phoneNumber], (error, results) => { return error ? resolve(100) : resolve(results) })
    })
}

function getByPhoneNumberAndCode(connection, phoneNumber, code) {
    return new Promise((resolve, reject) => {
        let query = 'SELECT * FROM ' + table + ' WHERE phone = ? AND otp_code = ? ' //LIMIT 1
        connection.query(query, [phoneNumber, code], (error, result) => { return error ? resolve(100) : resolve(result) })
    })
}

function resetTriesNumberToZero(connection, phoneNumber) {
    return new Promise((resolve, reject) => {

        /*
        console.log('time between now and last code > 24 hours then reset the tries and send new code');
        */

        let query = 'UPDATE ' + table + 'SET tries = ? WHERE phone = ?'

        connection.query(query, [0, phoneNumber], function (error) { return error ? resolve(true) : resolve(false) })
    })
}

function create(connection, phoneNumber) {
    return new Promise((resolve, reject) => {

        /*
        console.log('create');
        */

        let code = generateCode()

        let values = { otp_code: code, phone: phoneNumber, tries: 1, send_at: (new Date()).getTime() }

        let query = 'INSERT INTO ' + table + ' SET ?'

        connection.query(query, values, function (error) { error ? console.log(error) : ''; return error ? resolve(100) : resolve(200) })

    })
}

function update(connection, phoneNumber, tries) {
    return new Promise((resolve, reject) => {

        // console.log('update +1 of tries');

        let code = generateCode()

        let values = { otp_code: code, tries: tries, send_at: (new Date()).getTime() }


        let query = 'UPDATE ' + table + ' SET ? WHERE phone = ?'


        connection.query(query, [values, phoneNumber], function (error) { /*error ? console.log(error) : console.log('tmt');*/ return error ? resolve(100) : resolve(200) })

    })
}

const allowedToGenerateNewCode = async function (connection, record, phone, tries) {


    let lastMessageSentAt = record.send_at

    let currentTime = (new Date()).getTime()

    let h24 = 60 * 60 * 24
    /*
    let h24 = 24 // for test
    */


    if (((currentTime - lastMessageSentAt) / 1000) < h24) {

        // at the same day and completed the all available triess => not allowed

        /*
        console.log('[ at the same day ] time between now and last sent code < 24 hours');
        console.log('if true not exceded the allowed number of tries ' + (record.tries + 1) + '/' + tries);
        console.log('if false sorry,  exceded the allowed number of tries ' + (record.tries + 1) + '/' + tries);
        */

        return ((parseInt(record.tries) + 1) <= tries);

    } else {
        // not at the same day (more than 24 h from last sent code) reset the tries to zero => allowed
        return await resetTriesNumberToZero(connection, phone)
    }
}

// generate code and save it in db and send to user in sms
// input mobile number
module.exports.otpCode = async function (connection, phone, tries) {

    let response = await getByPhoneNumber(connection, phone)
    let rows = []


    if (Array.isArray(response))
        rows = response
    else
        return response


    if (rows.length > 0) {

        // user exists in otp table

        response = await allowedToGenerateNewCode(connection, rows[0], phone, tries)
        if (response === true) {
            // increment the tries number one step (+1)
            /*
            console.log('allowed to generate new code');
            */
            return await update(connection, phone, rows[0].tries < tries ? rows[0].tries + 1 : 1)
        } else {
            // not allowed to regenerate in current day try after 24 hours
            /*
             console.log('not allowed try after 24 h');
            */
            return 300;
        }

    } else {
        // create new record
        return await create(connection, phone)
    }

}


// verify if the saved code equal the code in the request body
// input code and mobilePhone
module.exports.otpVerify = async function (connection, phone, code, expire) {

    let response = await getByPhoneNumberAndCode(connection, phone, code)

    let user = null

    if (Array.isArray(response) && response.length > 0)
        user = response[0]
    else
        return Number.isInteger(response) ? response : 100

    // here that mean that user and code exist so that we should validate expire date it must be less than or equal the default


    let lastMessageSentAt = user.send_at

    let currentTime = (new Date()).getTime()

    if (((currentTime - lastMessageSentAt) / 1000) <= expire * 60) { // then code valid

        let userInfo = {}
        const unknownError = 400

        userInfo = await User.findOne({ phone: phone })

        if (userInfo === null) {
            userInfo = await User.create({ phone: phone })

            if (userInfo === null) {
                return { code: unknownError }
            }
        }


        // get jwt and start generate the token with the user id only
        const userToken = JWT.sign({ user_id: userInfo._id }, jwtConfig.secret, jwtConfig.options)

        // store in redis and return in response

        /*
                // redisClient.on('connect', async function () {
                // })
                let x = await redis.createClient('6379', '127.0.0.1')
         
                x.set('name', 'hatem')
         
                console.log(x.exists('name'));
         
                // console.log(redisClient.exists('name'));
                // redisClient.exists(userInfo._id, function (err, reply) {
                //     if (reply === 1) {
                //         let newValue = [userToken, ...redisClient.get(userInfo._id)]
                //         redisClient.del(userInfo._id)
                //         redisClient.set(userInfo._id, newValue)
                //         redisClient.expire(userInfo._id, jwtConfig.options.expiresIn)
                //     } else {
                //         redisClient.set(userInfo._id, [userToken])
                //         redisClient.expire(userInfo._id, jwtConfig.options.expiresIn)
                //     }
                // });
                */

        // return the token back to android and make endpoint to check if he is verified or not
        return { code: 200, token: userToken }

    } else {
        // code is expired
        return { code: 300 }
    }

}
