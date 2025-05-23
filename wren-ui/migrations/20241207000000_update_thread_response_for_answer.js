const constructCteSql = (steps) => {
  // if empty, return empty string
  if (steps.length === 0) {
    return '';
  }

  // if there's only one step, return the sql directly
  if (steps.length === 1) {
    return steps[0].sql;
  }

  let sql = 'WITH ';
  steps.forEach((step, index) => {
    if (index === steps.length - 1) {
      // if it's the last step, remove the trailing comma.
      // no need to wrap with WITH
      sql += `${step.sql}`;
    } else if (index === steps.length - 2) {
      // if it's the last two steps, remove the trailing comma.
      // wrap with CTE
      sql += `${step.cteName} AS`;
      sql += `(${step.sql})`;
    } else {
      // if it's not the last step, wrap with CTE
      sql += `${step.cteName} AS`;
      sql += `(${step.sql}),`;
    }
  });

  return sql;
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('thread_response', (table) => {
    table.renameColumn('detail', 'breakdown_detail');
    table
      .text('sql')
      .nullable()
      .comment('the SQL query generated by AI service');
    table
      .jsonb('answer_detail')
      .defaultTo('{}')
      .comment('AI generated text-based answer detail');
    table
      .integer('view_id')
      .nullable()
      .comment('the view ID associated with the response');
  });

  const threadResponses = await knex('thread_response').select(
    'id',
    'query_id',
    'status',
    'breakdown_detail',
    'error',
  );

  for (const response of threadResponses) {
    let errorDetail;
    try {
      errorDetail = JSON.parse(response.error);
    } catch (_e) {
      errorDetail = null;
    }

    let breakdownDetail;
    try {
      breakdownDetail = JSON.parse(response.breakdown_detail);
    } catch (_e) {
      breakdownDetail = {};
    }

    const updatedDetail = {
      queryId: response.query_id,
      status: response.status,
      error: errorDetail,
      ...breakdownDetail,
    };

    await knex('thread_response')
      .where('id', response.id)
      .update({
        sql: constructCteSql(breakdownDetail?.steps || []),
        breakdown_detail: JSON.stringify(updatedDetail),
        answer_detail: null,
        view_id: breakdownDetail.viewId || null,
      });
  }

  await knex.schema.alterTable('thread_response', (table) => {
    table.dropColumn('query_id');
    table.dropColumn('status');
    table.dropColumn('error');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('thread_response', (table) => {
    table.string('query_id').comment('the query id generated by AI service');
    table.string('status').comment('the status of the response');
    table.jsonb('error').nullable().comment('the error message if any');
    table.dropColumn('sql');
    table.dropColumn('answer_detail');
  });

  const threadResponses = await knex('thread_response')
    .select('id', 'breakdown_detail', 'view_id')
    .whereNotNull('breakdown_detail');

  for (const response of threadResponses) {
    // Parse the breakdown_detail field from the response
    let detail;
    try {
      detail = JSON.parse(response.breakdown_detail);
    } catch (_e) {
      detail = {};
    }

    // Convert the error detail to a string
    let errorString;
    try {
      errorString = JSON.stringify(detail.error);
    } catch (_e) {
      errorString = null;
    }

    // Update the thread_response table with the parsed details
    await knex('thread_response')
      .where('id', response.id)
      .update({
        query_id: detail.queryId,
        status: detail.status,
        error: errorString,
        breakdown_detail: JSON.stringify({
          ...detail,
          viewId: response.view_id,
          queryId: undefined,
          status: undefined,
          error: undefined,
        }),
      });
  }

  await knex.schema.alterTable('thread_response', (table) => {
    table.dropColumn('view_id');
    table.renameColumn('breakdown_detail', 'detail');
  });
};
