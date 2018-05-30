const Pool = require('pg').Pool;
        var dbPool = new Pool({
        user: process.env.PGUSER || 'geodb',
        password: process.env.PGPASSWORD || 'geodb',
        host: process.env.PGHOST || 'localhost',
        database: process.env.PGDATABASE || 'locophoto',
        port: process.env.PGPORT || 5432,
        max: 20, // max number of clients in pool
        idleTimeoutMillis: 1000 // close & remove clients which have been idle > 1 second
    });

async function dbUpdateHashTags(photoid, description)
{
    const deleteSQL = "delete from hashtags where photoid=$1";
    await dbPool.query(deleteSQL, [photoid]);
    if (description && typeof description == "string") {
        const tags = [...new Set(description.toLowerCase().match(/#[a-z0-9_]+/g))];
        for (let uniqueTag of tags) {
            const addSQL = "insert into hashtags (photoid, hashtag) values ($1, $2)";
            await dbPool.query(addSQL, [photoid, uniqueTag.replace('#', '')]);
        }
    }
}

async function updateAllHashTags()
{
    let sql = "drop table if exists hashtags";
    await dbPool.query(sql);
    sql = "create table hashtags (id serial primary key, photoid int, hashtag varchar)";
    await dbPool.query(sql);
    sql = "select id, description from photo where description is not null and char_length(description) > 0";
    const descriptions = await dbPool.query(sql);
    for (let i = 0; i < descriptions.rows.length; i++) {
        await dbUpdateHashTags(descriptions.rows[i].id, descriptions.rows[i].description);
    }
    sql = "create index hashtagshashtagsidx on hashtags(hashtag)";
    await dbPool.query(sql);
}

updateAllHashTags();