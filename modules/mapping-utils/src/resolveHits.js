import getFields from 'graphql-fields';
import buildQuery from './buildQuery';

let joinParent = (parent, field) => (parent ? `${parent}.${field}` : field);

let resolveNested = ({ node, nested_fields, parent = '' }) => {
  if (typeof node !== 'object' || !node) return node;

  return Object.entries(node).reduce((acc, [field, hits]) => {
    // TODO: inner hits query if necessary
    const fullPath = joinParent(parent, field);

    return {
      ...acc,
      [field]: nested_fields.includes(fullPath)
        ? {
            hits: {
              edges: hits.map(node => ({
                node: {
                  ...node,
                  ...resolveNested({
                    node,
                    nested_fields,
                    parent: fullPath,
                  }),
                },
              })),
              total: hits.length,
            },
          }
        : typeof hits === 'object'
          ? Object.assign(
              hits.constructor(),
              resolveNested({
                node: hits,
                nested_fields,
                parent: fullPath,
              }),
            )
          : resolveNested({
              node: hits,
              nested_fields,
              parent: fullPath,
            }),
    };
  }, {});
};

export default type => async (
  obj,
  { first = 10, offset = 0, filters, score, sort },
  { es },
  info,
) => {
  let fields = getFields(info);
  let nested_fields = type.nested_fields;

  let query = filters;

  if (filters || score) {
    query = buildQuery({ filters, score, nested_fields });
  }

  let body =
    (query && {
      query,
    }) ||
    {};

  if (sort && sort.length) {
    // TODO: add query here to sort based on result. https://www.elastic.co/guide/en/elasticsearch/guide/current/nested-sorting.html
    body.sort = sort.map(({ field, missing, ...rest }) => {
      const nested_path = nested_fields.find(
        nestedField => field.indexOf(nestedField) === 0,
      );

      return {
        [field]: {
          missing: missing === 'first' ? '_first' : '_last',
          ...rest,
          ...(nested_path ? { nested_path } : {}),
        },
      };
    });
  }

  let { hits } = await es.search({
    index: type.index,
    type: type.es_type,
    size: first,
    from: offset,
    _source: fields.edges && Object.keys(fields.edges.node),
    track_scores: !!score,
    body,
  });

  let nodes = hits.hits.map(x => {
    let source = x._source;
    let nested_nodes = resolveNested({
      node: source,
      nested_fields,
    });
    return { id: x._id, ...source, ...nested_nodes };
  });

  return {
    hits: nodes,
    total: hits.total,
  };
};
